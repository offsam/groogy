import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isPlaceholderBusinessImage } from "@/lib/business/media";

const BUCKET = "business-images";
const IMPORT_REVIEW_RE =
  /\/storage\/v1\/object\/public\/business-images\/(import-review\/[^?]+)/i;

function parseImportReviewObjectPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(IMPORT_REVIEW_RE);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

function publicObjectUrl(supabaseUrl: string, objectPath: string): string {
  const base = supabaseUrl.replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${BUCKET}/${objectPath}`;
}

function needsImagePromotion(url: string | null | undefined): boolean {
  const trimmed = String(url || "").trim();
  if (!trimmed) return true;
  if (isPlaceholderBusinessImage(trimmed)) return true;
  return Boolean(parseImportReviewObjectPath(trimmed));
}

/**
 * If an entity still points at import-review/…, copy the object into
 * business/{id}/ or professional/{id}/ and rewrite image_url.
 * Returns the final public URL (existing or promoted), or null.
 */
export async function promoteImportReviewImageToEntity(
  supabase: SupabaseClient,
  opts: {
    entityType: "business" | "professional";
    entityId: string;
    currentImageUrl: string | null | undefined;
    fallbackPreviewUrl?: string | null;
  },
): Promise<{ ok: true; url: string; promoted: boolean } | { ok: false; error: string }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) return { ok: false, error: "missing NEXT_PUBLIC_SUPABASE_URL" };

  // Never overwrite a healthy real photo. Category SVGs / placeholders and
  // staging import-review URLs may be replaced.
  if (
    opts.currentImageUrl?.trim() &&
    !needsImagePromotion(opts.currentImageUrl)
  ) {
    return { ok: true, url: opts.currentImageUrl.trim(), promoted: false };
  }

  const sourceUrl =
    (opts.currentImageUrl && parseImportReviewObjectPath(opts.currentImageUrl)
      ? opts.currentImageUrl
      : null) ||
    (opts.fallbackPreviewUrl && parseImportReviewObjectPath(opts.fallbackPreviewUrl)
      ? opts.fallbackPreviewUrl
      : null);

  const table = opts.entityType === "business" ? "businesses" : "professionals";

  // Real photo already on the queue card (any public URL): replace placeholder.
  if (!sourceUrl) {
    const realFallback = (() => {
      const u = String(opts.fallbackPreviewUrl || "").trim();
      if (!u || isPlaceholderBusinessImage(u)) return null;
      return u;
    })();
    if (realFallback) {
      const { error: updError } = await supabase
        .from(table)
        .update({ image_url: realFallback })
        .eq("id", opts.entityId);
      if (updError) return { ok: false, error: updError.message };
      return { ok: true, url: realFallback, promoted: true };
    }
    return { ok: false, error: "no import-review image to promote" };
  }

  const sourcePath = parseImportReviewObjectPath(sourceUrl);
  if (!sourcePath) {
    return { ok: true, url: sourceUrl, promoted: false };
  }

  const fileName = sourcePath.split("/").pop() || `${opts.entityId}.webp`;
  const destFolder = opts.entityType === "business" ? "business" : "professional";
  const destPath = `${destFolder}/${opts.entityId}/${fileName}`;
  const destUrl = publicObjectUrl(supabaseUrl, destPath);

  // Already pointing at final path — nothing to do.
  if (opts.currentImageUrl?.includes(`/${destFolder}/${opts.entityId}/`)) {
    return { ok: true, url: opts.currentImageUrl, promoted: false };
  }

  const { data: blob, error: dlError } = await supabase.storage
    .from(BUCKET)
    .download(sourcePath);
  if (dlError || !blob) {
    return { ok: false, error: dlError?.message || "download failed" };
  }

  const bytes = Buffer.from(await blob.arrayBuffer());
  const { error: upError } = await supabase.storage.from(BUCKET).upload(destPath, bytes, {
    contentType: blob.type || "image/webp",
    upsert: true,
  });
  if (upError) return { ok: false, error: upError.message };

  const { error: updError } = await supabase
    .from(table)
    .update({ image_url: destUrl })
    .eq("id", opts.entityId);
  if (updError) return { ok: false, error: updError.message };

  return { ok: true, url: destUrl, promoted: true };
}

/**
 * Delete import-review/{itemId}/… objects only when no published entity
 * still references those public URLs.
 */
export async function deleteImportReviewStorageIfUnreferenced(
  supabase: SupabaseClient,
  itemId: string,
  previewImageUrl?: string | null,
): Promise<{ deleted: number; skipped: string | null }> {
  const prefix = `import-review/${itemId}`;
  const { data: listed, error: listError } = await supabase.storage
    .from(BUCKET)
    .list(prefix, { limit: 100 });
  if (listError) return { deleted: 0, skipped: listError.message };
  const files = (listed || []).filter((f) => f.id != null || f.metadata);
  if (!files.length) return { deleted: 0, skipped: null };

  const paths = files.map((f) => `${prefix}/${f.name}`);
  const urls = paths.map((p) => {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") || "";
    return `${base}/storage/v1/object/public/${BUCKET}/${p}`;
  });
  if (previewImageUrl?.trim()) urls.push(previewImageUrl.trim().split("?")[0]!);

  for (const url of urls) {
    const { count: bizCount } = await supabase
      .from("businesses")
      .select("*", { count: "exact", head: true })
      .eq("image_url", url);
    if ((bizCount || 0) > 0) {
      return { deleted: 0, skipped: "referenced_by_business" };
    }
    const { count: proCount } = await supabase
      .from("professionals")
      .select("*", { count: "exact", head: true })
      .eq("image_url", url);
    if ((proCount || 0) > 0) {
      return { deleted: 0, skipped: "referenced_by_professional" };
    }
  }

  const { error: rmError } = await supabase.storage.from(BUCKET).remove(paths);
  if (rmError) return { deleted: 0, skipped: rmError.message };

  // Avoid broken admin previews pointing at deleted objects.
  await supabase
    .from("import_review_items")
    .update({ preview_image_url: null })
    .eq("id", itemId)
    .in("review_status", ["approved", "rejected", "duplicate"]);

  return { deleted: paths.length, skipped: null };
}

/**
 * Best-effort post-settle retention: promote image if needed, then drop
 * unreferenced import-review objects. Never throws; never fails the parent action.
 */
export async function afterImportReviewSettledRetention(
  supabase: SupabaseClient,
  opts: {
    itemId: string;
    previewImageUrl?: string | null;
    publishedEntityType?: string | null;
    publishedEntityId?: string | null;
  },
): Promise<void> {
  try {
    const entityType =
      opts.publishedEntityType === "business" ||
      opts.publishedEntityType === "organization" ||
      opts.publishedEntityType === "service"
        ? "business"
        : opts.publishedEntityType === "professional" ||
            opts.publishedEntityType === "private_specialist"
          ? "professional"
          : null;

    if (entityType && opts.publishedEntityId) {
      const table = entityType === "business" ? "businesses" : "professionals";
      const { data: row } = await supabase
        .from(table)
        .select("id, image_url")
        .eq("id", opts.publishedEntityId)
        .maybeSingle();
      if (row) {
        let promotedOk = !needsImagePromotion(row.image_url);
        if (!promotedOk) {
          const result = await promoteImportReviewImageToEntity(supabase, {
            entityType,
            entityId: row.id,
            currentImageUrl: row.image_url,
            fallbackPreviewUrl: opts.previewImageUrl,
          });
          promotedOk = result.ok;
        }
        // Keep staging files when the live card still has no real photo —
        // otherwise merge deletes the only copy under a category SVG.
        if (!promotedOk && opts.previewImageUrl?.trim()) {
          return;
        }
      }
    }

    await deleteImportReviewStorageIfUnreferenced(
      supabase,
      opts.itemId,
      opts.previewImageUrl,
    );
  } catch {
    // Retention must never break approve/reject.
  }
}
