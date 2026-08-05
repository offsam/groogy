"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  approveCommentRecommendationAction,
  confirmRecommendationMergeAction,
} from "@/lib/import-review/recommendation-actions";
import {
  mergeCatalogDuplicateFromLiveScanAction,
  scanLiveEntityDuplicatesAction,
  type LiveDuplicateHit,
} from "@/lib/admin/published-duplicates-scan";
import { reviewWorkspacePath } from "@/lib/admin/review-workspace/task-id";
import { userIsAdmin } from "@/lib/reviews/queries";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

const TO4KA_SOURCE = "to4ka";
/** Cap one autopost click so admin UI stays responsive. */
const AUTOPOST_LIMIT = 80;
/** Cap one recall scan click. */
const RECALL_LIMIT = 80;

export type To4kaPublishedRef = {
  recommendationId: string;
  kind: "business" | "professional";
  entityId: string;
  slug?: string | null;
  name: string;
};

export type To4kaAutopostResult =
  | {
      ok: true;
      message: string;
      published: To4kaPublishedRef[];
      failed: Array<{ id: string; name: string; message: string }>;
      remainingPending: number;
    }
  | { ok: false; message: string };

export type To4kaEnrichTarget = {
  kind: "business" | "professional";
  entityId: string;
  slug?: string | null;
  name: string;
  recommendationId: string;
};

export type To4kaRecalledDuplicate = {
  recommendationId: string;
  name: string;
  reviewHref: string;
  archivedKind: "business" | "professional";
  archivedId: string;
  archivedSlug?: string | null;
  archivedFillScore: number;
  matchKind: "business" | "professional";
  matchId: string;
  matchName: string;
  matchSlug?: string | null;
  matchHref?: string | null;
  matchFillScore: number;
  strength: "exact" | "weak";
  reason: string;
  suggestedKeep: "archived" | "match";
};

export type To4kaRecallResult =
  | {
      ok: true;
      message: string;
      recalled: To4kaRecalledDuplicate[];
      stayedPublic: number;
      scanned: number;
      failed: Array<{ id: string; name: string; message: string }>;
    }
  | { ok: false; message: string };

function anyFrom(client: SupabaseClient, table: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic admin tables
  return (client as any).from(table);
}

async function requireAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Нужно войти в аккаунт." as const };
  if (!(await userIsAdmin(supabase))) {
    return { error: "Только для администраторов." as const };
  }
  return { supabase, user, error: null as null };
}

function asBizPro(
  type: string | null | undefined,
): "business" | "professional" | null {
  if (type === "business" || type === "professional") return type;
  return null;
}

/**
 * Step 1: publish all pending to4ka recommendations as new live cards.
 * Uses force so duplicate gate does not silent-merge on this step.
 */
export async function bulkAutopublishTo4kaAction(): Promise<To4kaAutopostResult> {
  const auth = await requireAdmin();
  if (auth.error) return { ok: false, message: auth.error };

  let catalog: SupabaseClient;
  try {
    catalog = createServiceRoleClient();
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? err.message
          : "Нет service role — автопост недоступен.",
    };
  }

  const { data: rows, error } = await anyFrom(
    catalog,
    "import_comment_recommendations",
  )
    .select(
      "id, display_name, status, published_entity_id, kind, directory_source",
    )
    .eq("directory_source", TO4KA_SOURCE)
    .eq("kind", "profi")
    .eq("status", "pending")
    .is("published_entity_id", null)
    .order("updated_at", { ascending: false })
    .limit(AUTOPOST_LIMIT);

  if (error) return { ok: false, message: error.message };

  const pending = (rows ?? []) as Array<{
    id: string;
    display_name: string | null;
  }>;

  const published: To4kaPublishedRef[] = [];
  const failed: Array<{ id: string; name: string; message: string }> = [];

  for (const row of pending) {
    const name = (row.display_name || "").trim() || "Без названия";
    const res = await approveCommentRecommendationAction({
      id: row.id,
      force: true,
    });
    if (!res.ok) {
      failed.push({ id: row.id, name, message: res.message });
      continue;
    }
    const kind = asBizPro(res.publishedEntityType);
    if (!kind || !res.publishedEntityId) {
      failed.push({
        id: row.id,
        name,
        message: res.message || "Опубликовано, но тип карточки неизвестен.",
      });
      continue;
    }
    published.push({
      recommendationId: row.id,
      kind,
      entityId: res.publishedEntityId,
      name,
      slug: null,
    });
  }

  // Resolve slugs for enrich UI.
  for (const item of published) {
    const table = item.kind === "business" ? "businesses" : "professionals";
    const { data } = await anyFrom(catalog, table)
      .select("slug")
      .eq("id", item.entityId)
      .maybeSingle();
    item.slug = (data as { slug?: string } | null)?.slug ?? null;
  }

  const { count } = await anyFrom(catalog, "import_comment_recommendations")
    .select("id", { count: "exact", head: true })
    .eq("directory_source", TO4KA_SOURCE)
    .eq("kind", "profi")
    .eq("status", "pending")
    .is("published_entity_id", null);

  revalidatePath("/admin/imports/directories/to4ka");
  revalidatePath("/admin/review/inbox");

  return {
    ok: true,
    message: `Автопост: ${published.length} выложено, ${failed.length} ошибок.`,
    published,
    failed,
    remainingPending: count ?? 0,
  };
}

/**
 * List approved to4ka cards still public — targets for batch enrich / recall.
 */
export async function listTo4kaPublishedForPipelineAction(): Promise<
  | { ok: true; items: To4kaEnrichTarget[] }
  | { ok: false; message: string }
> {
  const auth = await requireAdmin();
  if (auth.error) return { ok: false, message: auth.error };

  let catalog: SupabaseClient;
  try {
    catalog = createServiceRoleClient();
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Нет service role.",
    };
  }

  const { data, error } = await anyFrom(
    catalog,
    "import_comment_recommendations",
  )
    .select(
      "id, display_name, published_entity_type, published_entity_id, status",
    )
    .eq("directory_source", TO4KA_SOURCE)
    .eq("kind", "profi")
    .eq("status", "approved")
    .not("published_entity_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(RECALL_LIMIT);

  if (error) return { ok: false, message: error.message };

  const items: To4kaEnrichTarget[] = [];
  for (const row of (data ?? []) as Array<{
    id: string;
    display_name: string | null;
    published_entity_type: string | null;
    published_entity_id: string | null;
  }>) {
    const kind = asBizPro(row.published_entity_type);
    if (!kind || !row.published_entity_id) continue;

    const table = kind === "business" ? "businesses" : "professionals";
    const { data: live } = await anyFrom(catalog, table)
      .select("id, slug, status, name, display_name")
      .eq("id", row.published_entity_id)
      .maybeSingle();
    const liveRow = live as {
      id: string;
      slug?: string;
      status?: string;
      name?: string;
      display_name?: string;
    } | null;
    if (!liveRow || liveRow.status === "archived") continue;

    items.push({
      recommendationId: row.id,
      kind,
      entityId: liveRow.id,
      slug: liveRow.slug ?? null,
      name:
        liveRow.display_name ||
        liveRow.name ||
        row.display_name ||
        "Без названия",
    });
  }

  return { ok: true, items };
}

function pickBestHit(hits: LiveDuplicateHit[]): LiveDuplicateHit | null {
  const catalogHits = hits.filter(
    (h) =>
      h.kind === "catalog" &&
      (h.entityType === "business" || h.entityType === "professional") &&
      h.status !== "archived",
  );
  if (!catalogHits.length) return null;
  const exact = catalogHits.find((h) => h.strength === "exact");
  return exact ?? catalogHits[0] ?? null;
}

function fillFromHit(hit: LiveDuplicateHit | null | undefined): number {
  return typeof hit?.fillScore === "number" ? hit.fillScore : 0;
}

/**
 * Step 3: scan approved to4ka live cards. No match → stay public.
 * Match → archive the to4ka card and return the recommendation to
 * suspected_duplicate in the to4ka admin queue.
 */
export async function recallTo4kaDuplicatesAction(): Promise<To4kaRecallResult> {
  const auth = await requireAdmin();
  if (auth.error) return { ok: false, message: auth.error };

  let catalog: SupabaseClient;
  try {
    catalog = createServiceRoleClient();
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Нет service role.",
    };
  }

  const listed = await listTo4kaPublishedForPipelineAction();
  if (!listed.ok) return listed;

  const recalled: To4kaRecalledDuplicate[] = [];
  const failed: Array<{ id: string; name: string; message: string }> = [];
  let stayedPublic = 0;
  let scanned = 0;

  for (const item of listed.items) {
    scanned += 1;
    const scan = await scanLiveEntityDuplicatesAction({
      entityType: item.kind,
      entityId: item.entityId,
    });
    if (!scan.ok) {
      failed.push({
        id: item.recommendationId,
        name: item.name,
        message: scan.message,
      });
      continue;
    }

    const hit = pickBestHit(scan.hits);
    if (!hit || !hit.entityType) {
      stayedPublic += 1;
      continue;
    }
    const matchKind = asBizPro(hit.entityType);
    if (!matchKind) {
      stayedPublic += 1;
      continue;
    }

    const matchFill = fillFromHit(hit);
    let archivedFill = 0;
    {
      const selfTable =
        item.kind === "business" ? "businesses" : "professionals";
      const { data: selfRow } = await anyFrom(catalog, selfTable)
        .select(
          item.kind === "business"
            ? "phone, website, email, instagram_url, telegram_url, description, short_description, image_url, address_line, city"
            : "phone, website, email, instagram_url, telegram_url, description, short_description, image_url, private_address_line, city",
        )
        .eq("id", item.entityId)
        .maybeSingle();
      if (selfRow) {
        const s = selfRow as Record<string, unknown>;
        archivedFill = [
          "phone",
          "website",
          "email",
          "instagram_url",
          "telegram_url",
          "description",
          "short_description",
          "image_url",
          "address_line",
          "private_address_line",
          "city",
        ].filter((k) => {
          const v = s[k];
          return v != null && String(v).trim() !== "";
        }).length;
      }
    }
    const selfIsRicher =
      hit.suggestedKeepId === item.entityId || archivedFill > matchFill;

    const table =
      item.kind === "business" ? "businesses" : "professionals";
    const { error: archiveErr } = await anyFrom(catalog, table)
      .update({
        status: "archived",
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.entityId);
    if (archiveErr) {
      failed.push({
        id: item.recommendationId,
        name: item.name,
        message: `Не удалось снять с витрины: ${archiveErr.message}`,
      });
      continue;
    }

    const reason = `${hit.strength}: ${hit.reason}`.slice(0, 240);
    const { error: recErr } = await anyFrom(
      catalog,
      "import_comment_recommendations",
    )
      .update({
        status: "suspected_duplicate",
        duplicate_of_entity_type: matchKind,
        duplicate_of_entity_id: hit.id,
        duplicate_confidence: hit.strength === "exact" ? "confirmed" : "suspected",
        duplicate_reason: reason,
        // Keep published refs so admin can see which live card was archived.
        published_entity_type: item.kind,
        published_entity_id: item.entityId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.recommendationId);

    if (recErr) {
      failed.push({
        id: item.recommendationId,
        name: item.name,
        message: `Карточка снята, но очередь не обновилась: ${recErr.message}`,
      });
      continue;
    }

    recalled.push({
      recommendationId: item.recommendationId,
      name: item.name,
      reviewHref: reviewWorkspacePath("recommendation", item.recommendationId),
      archivedKind: item.kind,
      archivedId: item.entityId,
      archivedSlug: item.slug,
      archivedFillScore: archivedFill,
      matchKind,
      matchId: hit.id,
      matchName: hit.name,
      matchSlug: hit.slug,
      matchHref: hit.href,
      matchFillScore: matchFill,
      strength: hit.strength,
      reason: hit.reason,
      suggestedKeep: selfIsRicher ? "archived" : "match",
    });
  }

  revalidatePath("/admin/imports/directories/to4ka");
  revalidatePath("/admin/review/inbox");
  revalidatePath("/search");

  return {
    ok: true,
    message: `Скан: ${scanned}. Остались в открытом доступе: ${stayedPublic}. Вернулись в to4ka: ${recalled.length}.`,
    recalled,
    stayedPublic,
    scanned,
    failed,
  };
}

/** Load current suspected_duplicate rows for the to4ka matches panel. */
export async function listTo4kaSuspectedDuplicatesAction(): Promise<
  | { ok: true; items: To4kaRecalledDuplicate[] }
  | { ok: false; message: string }
> {
  const auth = await requireAdmin();
  if (auth.error) return { ok: false, message: auth.error };

  let catalog: SupabaseClient;
  try {
    catalog = createServiceRoleClient();
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Нет service role.",
    };
  }

  const { data, error } = await anyFrom(
    catalog,
    "import_comment_recommendations",
  )
    .select(
      "id, display_name, published_entity_type, published_entity_id, duplicate_of_entity_type, duplicate_of_entity_id, duplicate_reason, duplicate_confidence",
    )
    .eq("directory_source", TO4KA_SOURCE)
    .eq("kind", "profi")
    .eq("status", "suspected_duplicate")
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) return { ok: false, message: error.message };

  const items: To4kaRecalledDuplicate[] = [];
  for (const row of (data ?? []) as Array<{
    id: string;
    display_name: string | null;
    published_entity_type: string | null;
    published_entity_id: string | null;
    duplicate_of_entity_type: string | null;
    duplicate_of_entity_id: string | null;
    duplicate_reason: string | null;
    duplicate_confidence: string | null;
  }>) {
    const matchKind = asBizPro(row.duplicate_of_entity_type);
    if (!matchKind || !row.duplicate_of_entity_id) continue;

    const archivedKind = asBizPro(row.published_entity_type);
    const archivedId = row.published_entity_id;
    let archivedSlug: string | null = null;
    let archivedFill = 0;
    let matchFill = 0;
    let matchName = "—";
    let matchSlug: string | null = null;
    let matchHref: string | null = null;

    const matchTable =
      matchKind === "business" ? "businesses" : "professionals";
    const { data: matchRow } = await anyFrom(catalog, matchTable)
      .select(
        matchKind === "business"
          ? "id, slug, name, phone, website, email, instagram_url, telegram_url, description, short_description, image_url, address_line, city, status"
          : "id, slug, display_name, phone, website, email, instagram_url, telegram_url, description, short_description, image_url, private_address_line, city, status",
      )
      .eq("id", row.duplicate_of_entity_id)
      .maybeSingle();
    if (matchRow) {
      const m = matchRow as Record<string, unknown>;
      matchName = String(m.display_name || m.name || "—");
      matchSlug = (m.slug as string) || null;
      matchHref =
        matchKind === "business" && matchSlug
          ? `/business/${matchSlug}`
          : matchKind === "professional" && matchSlug
            ? `/professional/${matchSlug}`
            : null;
      matchFill = [
        "phone",
        "website",
        "email",
        "instagram_url",
        "telegram_url",
        "description",
        "short_description",
        "image_url",
        "address_line",
        "private_address_line",
        "city",
      ].filter((k) => {
        const v = m[k];
        return v != null && String(v).trim() !== "";
      }).length;
    }

    if (archivedKind && archivedId) {
      const archTable =
        archivedKind === "business" ? "businesses" : "professionals";
      const { data: archRow } = await anyFrom(catalog, archTable)
        .select(
          archivedKind === "business"
            ? "id, slug, name, phone, website, email, instagram_url, telegram_url, description, short_description, image_url, address_line, city"
            : "id, slug, display_name, phone, website, email, instagram_url, telegram_url, description, short_description, image_url, private_address_line, city",
        )
        .eq("id", archivedId)
        .maybeSingle();
      if (archRow) {
        const a = archRow as Record<string, unknown>;
        archivedSlug = (a.slug as string) || null;
        archivedFill = [
          "phone",
          "website",
          "email",
          "instagram_url",
          "telegram_url",
          "description",
          "short_description",
          "image_url",
          "address_line",
          "private_address_line",
          "city",
        ].filter((k) => {
          const v = a[k];
          return v != null && String(v).trim() !== "";
        }).length;
      }
    }

    const suggestedKeep: "archived" | "match" =
      archivedKind && archivedId && archivedFill > matchFill
        ? "archived"
        : "match";

    const strength: "exact" | "weak" =
      row.duplicate_confidence === "confirmed" ? "exact" : "weak";

    items.push({
      recommendationId: row.id,
      name: row.display_name?.trim() || "Без названия",
      reviewHref: reviewWorkspacePath("recommendation", row.id),
      archivedKind: archivedKind || matchKind,
      archivedId: archivedId || row.duplicate_of_entity_id,
      archivedSlug,
      archivedFillScore: archivedFill,
      matchKind,
      matchId: row.duplicate_of_entity_id,
      matchName,
      matchSlug,
      matchHref,
      matchFillScore: matchFill,
      strength,
      reason: row.duplicate_reason || "",
      suggestedKeep,
    });
  }

  return { ok: true, items };
}

/**
 * Manual merge favoring the richer card for a recalled to4ka duplicate.
 */
export async function mergeTo4kaDuplicateRicherAction(input: {
  recommendationId: string;
  keep: "archived" | "match";
  archivedKind: "business" | "professional";
  archivedId: string;
  archivedSlug?: string | null;
  matchKind: "business" | "professional";
  matchId: string;
  matchSlug?: string | null;
}): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const auth = await requireAdmin();
  if (auth.error) return { ok: false, message: auth.error };

  let catalog: SupabaseClient;
  try {
    catalog = createServiceRoleClient();
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Нет service role.",
    };
  }

  if (input.keep === "match") {
    // Attach recommendation into the existing richer live card.
    const merge = await confirmRecommendationMergeAction({
      id: input.recommendationId,
      entityType: input.matchKind,
      entityId: input.matchId,
    });
    if (!merge.ok) return { ok: false, message: merge.message };

    // Ensure archived to4ka card stays off the shelf.
    const table =
      input.archivedKind === "business" ? "businesses" : "professionals";
    await anyFrom(catalog, table)
      .update({
        status: "archived",
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.archivedId);

    revalidatePath("/admin/imports/directories/to4ka");
    return {
      ok: true,
      message: merge.message || "Склеено в пользу существующей карточки.",
    };
  }

  // Keep archived to4ka card: restore it, fold match into it, mark rec approved.
  const keepTable =
    input.archivedKind === "business" ? "businesses" : "professionals";
  const { error: restoreErr } = await anyFrom(catalog, keepTable)
    .update({
      status: "approved",
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.archivedId);
  if (restoreErr) {
    return {
      ok: false,
      message: `Не удалось вернуть карточку на витрину: ${restoreErr.message}`,
    };
  }

  const catalogMerge = await mergeCatalogDuplicateFromLiveScanAction({
    keepKind: input.archivedKind,
    dropKind: input.matchKind,
    keepId: input.archivedId,
    dropId: input.matchId,
    keepSlug: input.archivedSlug,
    dropSlug: input.matchSlug,
  });
  if (!catalogMerge.ok) {
    return { ok: false, message: catalogMerge.message };
  }

  await anyFrom(catalog, "import_comment_recommendations")
    .update({
      status: "approved",
      published_entity_type: input.archivedKind,
      published_entity_id: input.archivedId,
      duplicate_of_entity_type: null,
      duplicate_of_entity_id: null,
      duplicate_confidence: null,
      duplicate_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.recommendationId);

  revalidatePath("/admin/imports/directories/to4ka");
  revalidatePath("/search");
  return {
    ok: true,
    message:
      catalogMerge.message ||
      "Склеено в пользу карточки to4ka (богаче).",
  };
}
