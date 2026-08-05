"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeStructuredAddress,
  validateStructuredAddress,
} from "@/lib/address/normalize";
import { resolveStreetGeoFields } from "@/lib/geo/geocode-street";
import {
  BUSINESS_COVER_MAX_UPLOAD_BYTES,
  BUSINESS_IMAGES_BUCKET,
  optimizeBusinessCover,
} from "@/lib/business/optimize-image.server";
import { normalizeTelegramInput } from "@/lib/business/presence";
import {
  serializeContactLinks,
  type ContactLink,
} from "@/lib/contacts/channels";
import { slugifyChurchName, parseChurchMinistries } from "@/lib/churches/mappers";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import type {
  ChurchMinistry,
  ChurchSourceKind,
  ChurchStatus,
} from "@/types/church";
import type { OpeningHours } from "@/lib/business/opening-hours";
import { parseOpeningHours } from "@/lib/business/opening-hours";

export type AdminChurchActionResult =
  | { ok: true; message?: string; id?: string; slug?: string }
  | { ok: false; message: string };

function fail(message: string): AdminChurchActionResult {
  return { ok: false, message };
}

function ok(
  message?: string,
  id?: string,
  slug?: string,
): AdminChurchActionResult {
  return { ok: true, message, id, slug };
}

async function requireAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, error: fail("Нужно войти в аккаунт.") };
  }
  if (!(await userIsAdmin(supabase))) {
    return { supabase, error: fail("Только для администраторов.") };
  }
  return { supabase, error: null };
}

function churchesTable(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
) {
  return (supabase as unknown as SupabaseClient).from("churches");
}

/** One ministry per line: `title` or `title | detail` or `title | detail | url`. */
function parseChurchMinistriesFromLines(raw: string): ChurchMinistry[] {
  const out: ChurchMinistry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("|").map((p) => p.trim());
    const title = parts[0] || "";
    if (!title) continue;
    out.push({
      title: title.slice(0, 160),
      detail: parts[1] || null,
      url: parts[2] || null,
    });
  }
  return out;
}

export async function adminUpsertChurchAction(input: {
  id?: string | null;
  name: string;
  slug: string;
  description?: string;
  phone?: string;
  email?: string;
  website?: string;
  instagramUrl?: string;
  telegramUrl?: string;
  googleMapsUrl?: string;
  contactLinks?: ContactLink[];
  city?: string;
  addressLine?: string;
  region?: string | null;
  stateCode?: string | null;
  postalCode?: string | null;
  status?: ChurchStatus;
  sourceUrl?: string;
  sourceKind?: ChurchSourceKind;
  imageUrl?: string;
  scheduleText?: string;
  ministries?: ChurchMinistry[] | string;
  openingHours?: OpeningHours | null;
}): Promise<AdminChurchActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const name = input.name.trim();
  if (!name) return fail("Укажите название.");

  const slug = (input.slug || slugifyChurchName(name)).trim();
  if (!slug) return fail("Укажите slug.");

  const normalized = normalizeStructuredAddress({
    addressLine: input.addressLine,
    city: input.city,
    region: input.region,
    stateCode: input.stateCode,
    postalCode: input.postalCode,
    businessName: name,
  });
  const issues = validateStructuredAddress(normalized, {
    businessName: name,
  });
  if (issues.length > 0) {
    return fail(issues[0]!.message);
  }

  const status: ChurchStatus = input.status ?? "draft";
  const sourceKind =
    input.sourceKind ?? (input.id ? undefined : ("platform" as const));
  const sourceUrl = (input.sourceUrl ?? "").trim() || null;

  let ministries: ChurchMinistry[] = [];
  if (typeof input.ministries === "string") {
    ministries = parseChurchMinistriesFromLines(input.ministries);
  } else if (Array.isArray(input.ministries)) {
    ministries = parseChurchMinistries(input.ministries);
  }

  const openingHours = parseOpeningHours(input.openingHours);

  const geo = await resolveStreetGeoFields({
    addressLine: normalized.addressLine,
    city: normalized.city,
    stateCode: normalized.stateCode,
    postalCode: normalized.postalCode,
    region: normalized.region,
  });

  const payload: Record<string, unknown> = {
    name,
    slug,
    description: (input.description ?? "").trim() || null,
    phone: (input.phone ?? "").trim() || null,
    email: (input.email ?? "").trim() || null,
    website: (input.website ?? "").trim() || null,
    instagram_url: (input.instagramUrl ?? "").trim() || null,
    telegram_url: normalizeTelegramInput(input.telegramUrl),
    google_maps_url:
      (input.googleMapsUrl ?? "").trim() || geo.google_maps_url || null,
    contact_links: serializeContactLinks(input.contactLinks ?? []),
    address_line: geo.addressLine || normalized.addressLine || null,
    city: normalized.city || null,
    region: normalized.region || null,
    state_code: normalized.stateCode || null,
    postal_code: normalized.postalCode || geo.postalCode || null,
    location_precision: geo.location_precision,
    latitude: geo.latitude,
    longitude: geo.longitude,
    status,
    image_url: (input.imageUrl ?? "").trim() || null,
    schedule_text: (input.scheduleText ?? "").trim() || null,
    ministries,
  };

  if (input.openingHours !== undefined) {
    payload.opening_hours = openingHours;
  }

  if (sourceKind !== undefined) {
    payload.source_kind = sourceKind;
  }
  if (input.sourceUrl !== undefined || !input.id) {
    payload.source_url = sourceUrl;
  }

  const table = churchesTable(supabase);

  if (input.id) {
    const { error: updateError } = await table
      .update(payload)
      .eq("id", input.id);
    if (updateError) {
      if (updateError.message?.toLowerCase().includes("duplicate")) {
        return fail("Slug уже занят.");
      }
      return fail(updateError.message || "Не удалось сохранить.");
    }
    revalidatePath("/admin/catalog/churches");
    revalidatePath("/churches");
    revalidatePath(`/churches/${slug}`);
    revalidatePath("/");
    return ok("Церковь обновлена.", input.id, slug);
  }

  const { data, error: insertError } = await table
    .insert(payload)
    .select("id, slug")
    .single();

  if (insertError) {
    if (insertError.message?.toLowerCase().includes("duplicate")) {
      return fail("Slug уже занят.");
    }
    return fail(insertError.message || "Не удалось создать.");
  }

  const row = data as unknown as { id: string; slug: string };
  revalidatePath("/admin/catalog/churches");
  revalidatePath("/churches");
  revalidatePath(`/churches/${row.slug}`);
  revalidatePath("/");
  return ok("Церковь создана.", row.id, row.slug);
}

export async function adminArchiveChurchAction(input: {
  id: string;
  slug?: string | null;
}): Promise<AdminChurchActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  if (!input.id.trim()) return fail("Не указан id.");

  const { error: updateError } = await churchesTable(supabase)
    .update({ status: "archived" })
    .eq("id", input.id);

  if (updateError) {
    return fail(updateError.message || "Не удалось архивировать.");
  }

  revalidatePath("/admin/catalog/churches");
  revalidatePath("/churches");
  if (input.slug) revalidatePath(`/churches/${input.slug}`);
  revalidatePath("/");
  return ok("Церковь в архиве.");
}

export type ChurchCoverUploadResult =
  | { ok: true; message?: string; imageUrl?: string }
  | { ok: false; message: string };

function churchCoverPathFromPublicUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${BUSINESS_IMAGES_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const path = decodeURIComponent(
    url.slice(idx + marker.length).split("?")[0] ?? "",
  );
  return path.startsWith("churches/") ? path : null;
}

/** Admin-only cover upload for a church card. */
export async function uploadChurchCoverAction(input: {
  churchId: string;
  churchSlug: string;
  formData: FormData;
}): Promise<ChurchCoverUploadResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const raw = input.formData.get("file");
  let file: File | null = null;
  if (raw instanceof File) {
    file = raw;
  } else if (typeof raw !== "string" && raw && typeof Blob !== "undefined") {
    const maybeBlob = raw as Blob;
    if (typeof maybeBlob.arrayBuffer === "function" && maybeBlob.size > 0) {
      file = new File([maybeBlob], "cover.webp", {
        type: maybeBlob.type || "image/webp",
      });
    }
  }
  if (!file || file.size === 0) {
    return { ok: false, message: "Выберите файл." };
  }
  const looksLikeImage =
    file.type.startsWith("image/") ||
    file.type === "" ||
    /\.(jpe?g|png|webp|gif)$/i.test(file.name);
  if (!looksLikeImage) {
    return { ok: false, message: "Допустимы только изображения." };
  }
  if (file.size > BUSINESS_COVER_MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      message: "Файл слишком большой после сжатия (макс. 12 МБ).",
    };
  }

  let optimized;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    optimized = await optimizeBusinessCover(buf);
  } catch {
    return { ok: false, message: "Не удалось обработать изображение." };
  }

  const filename = `${crypto.randomUUID()}.webp`;
  const storagePath = `churches/${input.churchId}/${filename}`;

  const { data: existing } = await churchesTable(supabase)
    .select("image_url")
    .eq("id", input.churchId)
    .maybeSingle();

  const { error: uploadError } = await supabase.storage
    .from(BUSINESS_IMAGES_BUCKET)
    .upload(storagePath, optimized.buffer, {
      contentType: optimized.contentType,
      upsert: false,
      cacheControl: "31536000",
    });

  if (uploadError) {
    return {
      ok: false,
      message: uploadError.message || "Не удалось загрузить файл.",
    };
  }

  const { data: publicData } = supabase.storage
    .from(BUSINESS_IMAGES_BUCKET)
    .getPublicUrl(storagePath);
  const imageUrl = publicData.publicUrl;

  const { error: updateError } = await churchesTable(supabase)
    .update({ image_url: imageUrl })
    .eq("id", input.churchId);

  if (updateError) {
    await supabase.storage.from(BUSINESS_IMAGES_BUCKET).remove([storagePath]);
    return {
      ok: false,
      message: updateError.message || "Не удалось сохранить фото.",
    };
  }

  const oldPath = churchCoverPathFromPublicUrl(
    (existing as { image_url?: string | null } | null)?.image_url,
  );
  if (oldPath && oldPath !== storagePath) {
    void supabase.storage.from(BUSINESS_IMAGES_BUCKET).remove([oldPath]);
  }

  revalidatePath(`/churches/${input.churchSlug}`);
  revalidatePath("/admin/catalog/churches");
  revalidatePath(`/admin/catalog/churches/${input.churchId}/edit`);
  revalidatePath("/churches");
  return { ok: true, message: "Фото обновлено.", imageUrl };
}
