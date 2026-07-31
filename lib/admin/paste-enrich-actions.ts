"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { userIsAdmin } from "@/lib/reviews/queries";
import {
  BUSINESS_COVER_MAX_UPLOAD_BYTES,
  BUSINESS_IMAGES_BUCKET,
  optimizeBusinessCover,
} from "@/lib/business/optimize-image.server";
import {
  parsePasteEnrichTextNormalized,
  pasteEnrichFillEmptyPatch,
  type PasteEnrichExisting,
  type PasteEnrichExtracted,
} from "@/lib/admin/paste-enrich";
import { parsePasteEnrichTextWithName } from "@/lib/admin/paste-enrich-name";
import { readPasteEnrichImageText } from "@/lib/admin/paste-enrich-vision";
import type { OpeningHours } from "@/lib/business/opening-hours";
import { parseOpeningHours } from "@/lib/business/opening-hours";
import {
  CONTACT_LINKS_COLUMN_READY,
  parseContactLinks,
  serializeContactLinks,
  type ContactLink,
} from "@/lib/contacts/channels";

export type PasteEnrichTargetKind =
  | "import_review"
  | "business"
  | "professional";

export type PasteEnrichActionResult =
  | {
      ok: true;
      message: string;
      filled: string[];
    }
  | { ok: false; message: string };

function fail(message: string): PasteEnrichActionResult {
  return { ok: false, message };
}

function ok(message: string, filled: string[]): PasteEnrichActionResult {
  return { ok: true, message, filled };
}

function untyped(client: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client as any;
}

async function requireAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, error: fail("Нужно войти в аккаунт.") };
  }
  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    return { supabase, error: fail("Только для администраторов.") };
  }
  return { supabase, error: null as null };
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((x) => String(x || "").trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function emptyScalar(value: unknown): boolean {
  return !(typeof value === "string" ? value.trim() : value);
}

async function uploadPasteImage(input: {
  catalog: SupabaseClient;
  file: File;
  storagePrefix: string;
}): Promise<{ ok: true; imageUrl: string } | { ok: false; message: string }> {
  const looksLikeImage =
    input.file.type.startsWith("image/") ||
    input.file.type === "" ||
    /\.(jpe?g|png|webp|gif)$/i.test(input.file.name);
  if (!looksLikeImage) {
    return { ok: false, message: "Допустимы только изображения." };
  }
  if (input.file.size > BUSINESS_COVER_MAX_UPLOAD_BYTES) {
    return { ok: false, message: "Файл слишком большой (макс. 12 МБ)." };
  }

  let optimized;
  try {
    const raw = Buffer.from(await input.file.arrayBuffer());
    optimized = await optimizeBusinessCover(raw);
  } catch {
    return { ok: false, message: "Не удалось обработать изображение." };
  }

  const filename = `${crypto.randomUUID()}.webp`;
  const storagePath = `${input.storagePrefix.replace(/\/?$/, "/")}${filename}`;

  const { error: uploadError } = await input.catalog.storage
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

  const { data: publicData } = input.catalog.storage
    .from(BUSINESS_IMAGES_BUCKET)
    .getPublicUrl(storagePath);
  return { ok: true, imageUrl: publicData.publicUrl };
}

/** Pasted text and photo transcription are parsed as one blob. */
function combinePasteText(text: string, photoText: string): string {
  return [text, photoText]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}

function readFileFromFormData(formData: FormData): File | null {
  const raw = formData.get("file");
  if (raw instanceof File && raw.size > 0) return raw;
  return null;
}

function igUrl(handle: string): string {
  return `https://www.instagram.com/${handle.replace(/^@/, "")}/`;
}

function tgUrl(handle: string): string {
  return `https://t.me/${handle.replace(/^@/, "")}`;
}

function existingFromImportRow(row: Record<string, unknown>): PasteEnrichExisting {
  return {
    name: (row.business_name as string | null) ?? null,
    phone: asList(row.phone),
    email: asList(row.email),
    website: asList(row.website),
    instagram: asList(row.instagram),
    telegram: (row.telegram_username as string | null) ?? null,
    whatsapp: asList(row.whatsapp),
    facebook: null,
    googleMaps: null,
    city: (row.city as string | null) ?? null,
    state: (row.state as string | null) ?? null,
    addressLine: (row.address_line as string | null) ?? null,
    postalCode: (row.postal_code as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    imageUrl: (row.preview_image_url as string | null) ?? null,
  };
}

function contactLinkValue(
  links: ContactLink[],
  channel: ContactLink["channel"],
): string | null {
  const hit = links.find((l) => l.channel === channel);
  return hit?.value?.trim() || null;
}

function existingFromLiveRow(
  row: Record<string, unknown>,
  kind: "business" | "professional",
): PasteEnrichExisting {
  const desc =
    kind === "professional"
      ? ((row.description as string | null) ||
          (row.short_description as string | null) ||
          (row.card_summary as string | null) ||
          null)
      : ((row.description as string | null) ||
          (row.short_description as string | null) ||
          null);
  const links = parseContactLinks(row.contact_links);
  return {
    phone: row.phone as string | null,
    email: row.email as string | null,
    website: row.website as string | null,
    instagram: row.instagram_url as string | null,
    telegram: row.telegram_url as string | null,
    facebook: contactLinkValue(links, "facebook"),
    whatsapp: contactLinkValue(links, "whatsapp"),
    googleMaps:
      ((row.google_maps_url as string | null) ?? null) ||
      contactLinkValue(links, "google_maps"),
    city: row.city as string | null,
    state: (row.state_code as string | null) || (row.state as string | null) || null,
    addressLine:
      kind === "professional"
        ? ((row.private_address_line as string | null) ?? null)
        : ((row.address_line as string | null) ?? null),
    postalCode: (row.postal_code as string | null) ?? null,
    description: desc,
    imageUrl: row.image_url as string | null,
    openingHours: parseOpeningHours(row.opening_hours),
  };
}

function mergeContactLinksPatch(
  existingRaw: unknown,
  facebook: string | null | undefined,
  whatsapp: string | null | undefined,
  googleMaps?: string | null | undefined,
): ContactLink[] | null {
  if (!facebook && !whatsapp && !googleMaps) return null;
  const links = parseContactLinks(existingRaw);
  const byChannel = new Map(links.map((l) => [l.channel, l] as const));
  if (facebook && !byChannel.has("facebook")) {
    byChannel.set("facebook", { channel: "facebook", value: facebook, label: null });
  }
  if (whatsapp && !byChannel.has("whatsapp")) {
    byChannel.set("whatsapp", { channel: "whatsapp", value: whatsapp, label: null });
  }
  if (googleMaps && !byChannel.has("google_maps")) {
    byChannel.set("google_maps", {
      channel: "google_maps",
      value: googleMaps,
      label: null,
    });
  }
  return serializeContactLinks([...byChannel.values()]);
}

function liveDbPatch(
  existing: PasteEnrichExisting,
  extracted: PasteEnrichExtracted,
  imageUrl: string | null,
  kind: "business" | "professional",
  existingContactLinks: unknown,
): Record<string, unknown> {
  const logical = pasteEnrichFillEmptyPatch(existing, extracted, imageUrl);
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (logical.phone && Array.isArray(logical.phone) && logical.phone[0]) {
    patch.phone = logical.phone[0];
  }
  if (logical.email && Array.isArray(logical.email) && logical.email[0]) {
    patch.email = logical.email[0];
  }
  if (logical.website && Array.isArray(logical.website) && logical.website.length) {
    const preferred =
      logical.website.find(
        (u) => !/gumroad\.com|pdf|maps\.app|wtsp\.cc|wa\.me/i.test(String(u)),
      ) || logical.website[0];
    if (preferred) patch.website = preferred;
  }
  if (logical.instagram && Array.isArray(logical.instagram) && logical.instagram[0]) {
    patch.instagram_url = igUrl(String(logical.instagram[0]));
  }
  if (logical.telegram) {
    patch.telegram_url = tgUrl(String(logical.telegram));
  }
  if (logical.googleMaps) {
    if (kind === "business") {
      patch.google_maps_url = logical.googleMaps;
    }
  }
  if (logical.city) patch.city = logical.city;
  if (logical.state) {
    patch.state_code = logical.state;
  }
  if (logical.addressLine) {
    if (kind === "professional") {
      patch.private_address_line = logical.addressLine;
    } else {
      patch.address_line = logical.addressLine;
    }
  }
  if (logical.postalCode) {
    patch.postal_code = logical.postalCode;
  }
  if (logical.description) {
    patch.description = logical.description;
  }
  if (logical.imageUrl) {
    patch.image_url = logical.imageUrl;
  }
  if (logical.openingHours) {
    patch.opening_hours = logical.openingHours as OpeningHours;
  }

  if (CONTACT_LINKS_COLUMN_READY) {
    const merged = mergeContactLinksPatch(
      existingContactLinks,
      typeof logical.facebook === "string" ? logical.facebook : null,
      typeof logical.whatsapp === "string" ? logical.whatsapp : null,
      kind === "professional" && typeof logical.googleMaps === "string"
        ? logical.googleMaps
        : null,
    );
    if (merged) patch.contact_links = merged;
  }

  const keys = Object.keys(patch).filter((k) => k !== "updated_at");
  if (keys.length === 0) return {};
  return patch;
}

function importDbPatch(
  existing: PasteEnrichExisting,
  extracted: PasteEnrichExtracted,
  imageUrl: string | null,
): Record<string, unknown> {
  const logical = pasteEnrichFillEmptyPatch(existing, extracted, imageUrl);
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (logical.name) patch.business_name = logical.name;
  if (logical.phone) patch.phone = logical.phone;
  if (logical.email) patch.email = logical.email;
  if (logical.website) patch.website = logical.website;
  if (logical.instagram) patch.instagram = logical.instagram;
  if (logical.telegram) patch.telegram_username = logical.telegram;
  if (logical.whatsapp) patch.whatsapp = [logical.whatsapp];
  if (logical.city) patch.city = logical.city;
  if (logical.state) patch.state = logical.state;
  if (logical.addressLine) patch.address_line = logical.addressLine;
  if (logical.postalCode) patch.postal_code = logical.postalCode;
  if (logical.description) patch.description = logical.description;
  if (logical.imageUrl) patch.preview_image_url = logical.imageUrl;

  const keys = Object.keys(patch).filter((k) => k !== "updated_at");
  if (keys.length === 0) return {};
  return patch;
}

function filledLabels(patch: Record<string, unknown>): string[] {
  const map: Record<string, string> = {
    business_name: "название",
    phone: "телефон",
    email: "email",
    website: "сайт",
    instagram: "instagram",
    instagram_url: "instagram",
    telegram_username: "telegram",
    telegram_url: "telegram",
    whatsapp: "whatsapp",
    contact_links: "Facebook / WhatsApp",
    google_maps_url: "Google Maps",
    city: "город",
    state: "штат",
    state_code: "штат",
    address_line: "адрес",
    private_address_line: "адрес",
    postal_code: "ZIP",
    description: "описание",
    opening_hours: "часы работы",
    preview_image_url: "фото",
    image_url: "фото",
  };
  return Object.keys(patch)
    .filter((k) => k !== "updated_at")
    .map((k) => map[k] || k);
}

/**
 * Apply pasted free text (+ optional photo) to a card — admin only, fill-empty.
 * FormData: text, file?, kind, id, slug?
 */
export async function applyPasteEnrichAction(
  formData: FormData,
): Promise<PasteEnrichActionResult> {
  const { error: authError } = await requireAdmin();
  if (authError) return authError;

  const kind = String(formData.get("kind") || "").trim() as PasteEnrichTargetKind;
  const id = String(formData.get("id") || "").trim();
  const slug = String(formData.get("slug") || "").trim();
  const text = combinePasteText(
    String(formData.get("text") || ""),
    String(formData.get("photoText") || ""),
  );
  const file = readFileFromFormData(formData);

  if (!id || !["import_review", "business", "professional"].includes(kind)) {
    return fail("Некорректная цель.");
  }
  if (!text.trim() && !file) {
    return fail("Вставьте текст или прикрепите фото.");
  }

  let catalog: ReturnType<typeof createServiceRoleClient>;
  try {
    catalog = createServiceRoleClient();
  } catch (err) {
    return fail(
      err instanceof Error
        ? err.message
        : "Нет service role — запись недоступна.",
    );
  }

  // Only the import queue may take a name from the paste; live cards keep theirs.
  const extracted =
    kind === "import_review"
      ? parsePasteEnrichTextWithName(text)
      : parsePasteEnrichTextNormalized(text);

  if (kind === "import_review") {
    const { data: row, error: loadErr } = await untyped(catalog)
      .from("import_review_items")
      .select(
        "id, business_name, phone, email, website, instagram, telegram_username, whatsapp, city, state, address_line, postal_code, description, preview_image_url",
      )
      .eq("id", id)
      .maybeSingle();
    if (loadErr) return fail(loadErr.message);
    if (!row) return fail("Элемент очереди не найден.");

    const existing = existingFromImportRow(row as Record<string, unknown>);
    let imageUrl: string | null = null;
    if (file && emptyScalar(existing.imageUrl)) {
      const up = await uploadPasteImage({
        catalog,
        file,
        storagePrefix: `import-review/${id}`,
      });
      if (!up.ok) return fail(up.message);
      imageUrl = up.imageUrl;
    }

    const patch = importDbPatch(existing, extracted, imageUrl);
    if (Object.keys(patch).filter((k) => k !== "updated_at").length === 0) {
      return ok("Новых полей нет — всё уже заполнено или в тексте ничего не нашлось.", []);
    }

    const { error: updErr } = await untyped(catalog)
      .from("import_review_items")
      .update(patch)
      .eq("id", id);
    if (updErr) return fail(updErr.message);

    revalidatePath("/admin/import-review");
    revalidatePath(`/admin/import-review/${id}`);
    revalidatePath("/admin/review/inbox");
    revalidatePath(
      `/admin/review/${encodeURIComponent(`import_review:${id}`)}`,
    );
    const filled = filledLabels(patch);
    return ok(
      filled.length
        ? `Добавлено: ${filled.join(", ")}. Если появились сайт или соцсети — нажми Обогатить.`
        : "Готово.",
      filled,
    );
  }

  const table = kind === "business" ? "businesses" : "professionals";
  const selectCols =
    kind === "business"
      ? "id, slug, phone, email, website, instagram_url, telegram_url, google_maps_url, contact_links, city, state_code, address_line, postal_code, description, short_description, image_url, opening_hours"
      : "id, slug, phone, email, website, instagram_url, telegram_url, contact_links, city, state_code, private_address_line, postal_code, description, short_description, card_summary, image_url, opening_hours";

  const { data: row, error: loadErr } = await untyped(catalog)
    .from(table)
    .select(selectCols)
    .eq("id", id)
    .maybeSingle();
  if (loadErr) return fail(loadErr.message);
  if (!row) return fail("Карточка не найдена.");

  const existing = existingFromLiveRow(
    row as Record<string, unknown>,
    kind,
  );
  let imageUrl: string | null = null;
  if (file && emptyScalar(existing.imageUrl)) {
    const prefix =
      kind === "business" ? `covers/${id}` : `professionals/${id}`;
    const up = await uploadPasteImage({
      catalog,
      file,
      storagePrefix: prefix,
    });
    if (!up.ok) return fail(up.message);
    imageUrl = up.imageUrl;
  }

  const patch = liveDbPatch(
    existing,
    extracted,
    imageUrl,
    kind,
    (row as { contact_links?: unknown }).contact_links,
  );
  if (Object.keys(patch).length === 0) {
    return ok(
      "Новых полей нет — всё уже заполнено или в тексте ничего не нашлось.",
      [],
    );
  }

  const { error: updErr } = await untyped(catalog)
    .from(table)
    .update(patch)
    .eq("id", id);
  if (updErr) return fail(updErr.message);

  const liveSlug =
    slug || String((row as { slug?: string }).slug || "");
  if (kind === "business" && liveSlug) {
    revalidatePath(`/business/${liveSlug}`);
    revalidatePath("/admin/catalog/businesses");
  }
  if (kind === "professional" && liveSlug) {
    revalidatePath(`/professional/${liveSlug}`);
    revalidatePath("/admin/catalog/professionals");
  }
  revalidatePath("/search");

  const filled = filledLabels(patch);
  return ok(
    filled.length
      ? `Добавлено: ${filled.join(", ")}. Если появились сайт или соцсети — нажми Обогатить.`
      : "Готово.",
    filled,
  );
}

/**
 * Transcribe an attached photo so «Разобрать» can preview its fields.
 * Returns text only — nothing is written until «Применить».
 */
export async function readPasteEnrichImageAction(
  formData: FormData,
): Promise<
  { ok: true; text: string } | { ok: false; message: string }
> {
  const { error: authError } = await requireAdmin();
  if (authError) return { ok: false, message: authError.message };

  const file = readFileFromFormData(formData);
  if (!file) return { ok: false, message: "Файл не получен." };
  if (file.size > BUSINESS_COVER_MAX_UPLOAD_BYTES) {
    return { ok: false, message: "Файл слишком большой (макс. 12 МБ)." };
  }

  const result = await readPasteEnrichImageText(file);
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, text: result.text };
}

/** Preview-only (client can also parse locally; this loads current card emptiness). */
export async function loadPasteEnrichExistingAction(input: {
  kind: PasteEnrichTargetKind;
  id: string;
}): Promise<
  | { ok: true; existing: PasteEnrichExisting }
  | { ok: false; message: string }
> {
  const { error: authError } = await requireAdmin();
  if (authError) {
    return { ok: false, message: authError.message };
  }

  let catalog: ReturnType<typeof createServiceRoleClient>;
  try {
    catalog = createServiceRoleClient();
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : "Нет service role.",
    };
  }

  if (input.kind === "import_review") {
    const { data: row, error } = await untyped(catalog)
      .from("import_review_items")
      .select(
        "business_name, phone, email, website, instagram, telegram_username, whatsapp, city, state, address_line, postal_code, description, preview_image_url",
      )
      .eq("id", input.id)
      .maybeSingle();
    if (error) return { ok: false, message: error.message };
    if (!row) return { ok: false, message: "Не найдено." };
    return {
      ok: true,
      existing: existingFromImportRow(row as Record<string, unknown>),
    };
  }

  const table = input.kind === "business" ? "businesses" : "professionals";
  const selectCols =
    input.kind === "business"
      ? "phone, email, website, instagram_url, telegram_url, google_maps_url, contact_links, city, state_code, address_line, postal_code, description, short_description, image_url, opening_hours"
      : "phone, email, website, instagram_url, telegram_url, contact_links, city, state_code, private_address_line, postal_code, description, short_description, card_summary, image_url, opening_hours";
  const { data: row, error } = await untyped(catalog)
    .from(table)
    .select(selectCols)
    .eq("id", input.id)
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!row) return { ok: false, message: "Не найдено." };
  return {
    ok: true,
    existing: existingFromLiveRow(
      row as Record<string, unknown>,
      input.kind,
    ),
  };
}
