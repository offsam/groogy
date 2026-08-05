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
  pasteEnrichFillEmptyPatch,
  cardHasStreetPin,
  type PasteAddressGeoGate,
  type PasteEnrichExisting,
  type PasteEnrichExtracted,
  type PasteEnrichFieldKey,
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
import { addMissingBusinessOffers, menuItemsToImportedOffers } from "@/lib/business-offers/import-offers";
import {
  addMissingProfessionalServices,
  offersFromServiceNames,
} from "@/lib/professional/import-services";
import { stateCodeFromText } from "@/lib/address/normalize";
import {
  cleanAdminStreetAddress,
  resolveStreetGeoFields,
} from "@/lib/geo/geocode-street";

/** Paste extractors use `CA`; `businesses.state_code` FK needs `US-CA`. */
function toDbStateCode(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  return stateCodeFromText(raw) ?? null;
}

const REPLACE_FIELD_KEYS = new Set<PasteEnrichFieldKey>([
  "city",
  "state",
  "address",
  "postal",
]);

/** FormData `applyReplaceKeys` — empty string / missing → []. */
function readApplyReplaceKeys(
  formData: FormData,
): PasteEnrichFieldKey[] {
  const raw = formData.getAll("applyReplaceKeys").flatMap((v) =>
    String(v || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return [
    ...new Set(
      raw.filter((k): k is PasteEnrichFieldKey =>
        REPLACE_FIELD_KEYS.has(k as PasteEnrichFieldKey),
      ),
    ),
  ];
}

function fillOpts(applyReplaceKeys: PasteEnrichFieldKey[]) {
  return { applyReplaceKeys };
}

/** When paste changes street/city/ZIP, refresh the map pin (or clear a stale one). */
async function attachLiveStreetGeo(
  catalog: ReturnType<typeof createServiceRoleClient>,
  entityId: string,
  patch: Record<string, unknown>,
  existing: PasteEnrichExisting,
  kind: "business" | "professional" | "church",
): Promise<void> {
  const addressKey =
    kind === "professional" ? "private_address_line" : "address_line";
  const addressTouched =
    patch[addressKey] !== undefined ||
    patch.city !== undefined ||
    patch.state_code !== undefined ||
    patch.postal_code !== undefined;
  if (!addressTouched) return;

  const street =
    (typeof patch[addressKey] === "string" ? String(patch[addressKey]) : null) ??
    existing.addressLine ??
    null;
  const city =
    (typeof patch.city === "string" ? String(patch.city) : null) ??
    existing.city ??
    null;
  const stateCode =
    (typeof patch.state_code === "string" ? String(patch.state_code) : null) ??
    existing.state ??
    null;
  const postalCode =
    (typeof patch.postal_code === "string" ? String(patch.postal_code) : null) ??
    existing.postalCode ??
    null;

  const geo = await resolveStreetGeoFields({
    addressLine: street,
    city,
    stateCode,
    postalCode,
  });
  patch.latitude = geo.latitude;
  patch.longitude = geo.longitude;
  patch.location_precision = geo.location_precision;
  if (kind !== "professional" && geo.google_maps_url) {
    patch.google_maps_url = geo.google_maps_url;
  }
  if (!postalCode && geo.postalCode) {
    patch.postal_code = geo.postalCode;
  }
  if (geo.addressLine && geo.addressLine !== street) {
    patch[addressKey] = geo.addressLine;
  }

  // Profile map prefers primary business_locations over businesses.* —
  // keep that row in sync so the pin appears after paste.
  if (kind === "business") {
    await syncPrimaryBusinessLocationGeo(catalog, entityId, {
      addressLine:
        (typeof patch.address_line === "string"
          ? String(patch.address_line)
          : null) ?? street,
      city,
      stateCode,
      postalCode:
        (typeof patch.postal_code === "string"
          ? String(patch.postal_code)
          : null) ?? postalCode,
      latitude: geo.latitude,
      longitude: geo.longitude,
      locationPrecision: geo.location_precision,
      googleMapsUrl: geo.google_maps_url ?? null,
    });
  }
}

async function syncPrimaryBusinessLocationGeo(
  catalog: ReturnType<typeof createServiceRoleClient>,
  businessId: string,
  geo: {
    addressLine: string | null;
    city: string | null;
    stateCode: string | null;
    postalCode: string | null;
    latitude: number | null;
    longitude: number | null;
    locationPrecision: string | null;
    googleMapsUrl: string | null;
  },
): Promise<void> {
  const db = untyped(catalog);
  const { data: primary } = await db
    .from("business_locations")
    .select("id")
    .eq("business_id", businessId)
    .eq("status", "published")
    .eq("is_primary", true)
    .maybeSingle();

  const stateCode = toDbStateCode(geo.stateCode) ?? geo.stateCode;
  const row = {
    address_line: geo.addressLine?.slice(0, 160) || null,
    city: geo.city?.slice(0, 80) || null,
    state_code: stateCode || null,
    postal_code: geo.postalCode || null,
    latitude: geo.latitude,
    longitude: geo.longitude,
    location_precision: geo.locationPrecision,
    google_maps_url: geo.googleMapsUrl,
    kind: "street" as const,
    updated_at: new Date().toISOString(),
  };

  if (primary?.id) {
    await db.from("business_locations").update(row).eq("id", primary.id);
    return;
  }

  if (geo.latitude == null || geo.longitude == null || !geo.addressLine) {
    return;
  }

  await db.from("business_locations").insert({
    business_id: businessId,
    ...row,
    label: geo.city || null,
    is_primary: true,
    sort_order: 10,
    source: "paste_enrich",
    status: "published",
  });
}

export type PasteEnrichTargetKind =
  | "import_review"
  | "recommendation"
  | "business"
  | "professional"
  | "church";

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
  const websites = asList(row.website);
  const yelpFromWebsites =
    websites.find((u) => /yelp\.com\/biz\//i.test(u)) ?? null;
  const youtubeFromWebsites =
    websites.find((u) => /youtube\.com|youtu\.be/i.test(u)) ?? null;
  return {
    name: (row.business_name as string | null) ?? null,
    phone: asList(row.phone),
    email: asList(row.email),
    website: websites,
    instagram: asList(row.instagram),
    telegram: (row.telegram_username as string | null) ?? null,
    whatsapp: asList(row.whatsapp),
    facebook: null,
    youtube: youtubeFromWebsites,
    yelp: yelpFromWebsites,
    googleMaps: null,
    city: (row.city as string | null) ?? null,
    state: (row.state as string | null) ?? null,
    addressLine: (row.address_line as string | null) ?? null,
    postalCode: (row.postal_code as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    imageUrl: (row.preview_image_url as string | null) ?? null,
    services: asList(row.services),
  };
}

function emailsFromRecommendationNotes(notes: string | null): string[] {
  if (!notes) return [];
  for (const part of notes.split(";")) {
    const p = part.trim();
    if (p.toLowerCase().startsWith("emails:")) {
      return p
        .slice("emails:".length)
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    }
  }
  return [];
}

function existingFromRecommendationRow(
  row: Record<string, unknown>,
): PasteEnrichExisting {
  const notes = (row.notes as string | null) ?? null;
  const websites = asList(row.websites);
  const youtubeFromWebsites =
    websites.find((u) => /youtube\.com|youtu\.be/i.test(u)) ?? null;
  return {
    name: (row.display_name as string | null) ?? null,
    phone: asList(row.phones),
    email: emailsFromRecommendationNotes(notes),
    website: websites,
    instagram: asList(row.instagram),
    telegram: null,
    whatsapp: null,
    facebook: null,
    youtube: youtubeFromWebsites,
    yelp: null,
    googleMaps: null,
    city: (row.city as string | null) ?? null,
    state: (row.state_code as string | null) ?? null,
    addressLine: (row.address_line as string | null) ?? null,
    postalCode: null,
    description:
      asList(row.request_snippets)[0] ||
      asList(row.comment_texts)[0] ||
      null,
    imageUrl: (row.cover_image_url as string | null) ?? null,
    services: [],
  };
}

function setEmailsNote(notes: string | null, emails: string[]): string {
  const parts = (notes || "")
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !p.toLowerCase().startsWith("emails:"));
  if (emails.length) parts.push(`emails: ${emails.join(", ")}`);
  return parts.join("; ");
}

function recommendationDbPatch(
  existing: PasteEnrichExisting,
  extracted: PasteEnrichExtracted,
  imageUrl: string | null,
  currentNotes: string | null,
  applyReplaceKeys: PasteEnrichFieldKey[] = [],
): Record<string, unknown> {
  const logical = pasteEnrichFillEmptyPatch(
    existing,
    extracted,
    imageUrl,
    fillOpts(applyReplaceKeys),
  );
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (logical.name) patch.display_name = logical.name;
  if (logical.phone) {
    const phones = Array.isArray(logical.phone)
      ? logical.phone
      : [String(logical.phone)];
    patch.phones = phones.filter(Boolean);
  }
  if (logical.website) {
    const sites = Array.isArray(logical.website)
      ? [...logical.website]
      : [String(logical.website)];
    if (
      typeof logical.youtube === "string" &&
      logical.youtube &&
      !sites.some((u) => /youtube\.com|youtu\.be/i.test(String(u)))
    ) {
      sites.push(logical.youtube);
    }
    patch.websites = sites.filter(Boolean);
  } else if (typeof logical.youtube === "string" && logical.youtube) {
    patch.websites = [logical.youtube];
  }
  if (logical.instagram) {
    const ig = Array.isArray(logical.instagram)
      ? logical.instagram
      : [String(logical.instagram)];
    patch.instagram = ig
      .map((h) => String(h).replace(/^@/, "").toLowerCase())
      .filter(Boolean);
  }
  if (logical.email) {
    const emails = Array.isArray(logical.email)
      ? logical.email.map((e) => String(e).toLowerCase())
      : [String(logical.email).toLowerCase()];
    patch.notes = setEmailsNote(currentNotes, emails.filter(Boolean));
  }
  if (logical.city) patch.city = logical.city;
  if (logical.addressLine) patch.address_line = logical.addressLine;
  if (logical.imageUrl) patch.cover_image_url = logical.imageUrl;
  const keys = Object.keys(patch).filter((k) => k !== "updated_at");
  if (keys.length === 0) return {};
  return patch;
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
  kind: "business" | "professional" | "church",
  serviceTitles: string[] = [],
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
    name:
      kind === "professional"
        ? ((row.display_name as string | null) ?? null)
        : ((row.name as string | null) ?? null),
    phone: row.phone as string | null,
    email: row.email as string | null,
    website: row.website as string | null,
    instagram: row.instagram_url as string | null,
    telegram: row.telegram_url as string | null,
    facebook: contactLinkValue(links, "facebook"),
    youtube: contactLinkValue(links, "youtube"),
    whatsapp: contactLinkValue(links, "whatsapp"),
    yelp:
      kind === "business"
        ? ((row.yelp_url as string | null) ?? null)
        : contactLinkValue(links, "yelp"),
    trustpilot:
      kind === "business"
        ? ((row.trustpilot_url as string | null) ??
            contactLinkValue(links, "trustpilot"))
        : contactLinkValue(links, "trustpilot"),
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
    latitude:
      row.latitude != null && Number.isFinite(Number(row.latitude))
        ? Number(row.latitude)
        : null,
    longitude:
      row.longitude != null && Number.isFinite(Number(row.longitude))
        ? Number(row.longitude)
        : null,
    locationPrecision:
      typeof row.location_precision === "string"
        ? row.location_precision
        : null,
    description: desc,
    imageUrl: row.image_url as string | null,
    openingHours: parseOpeningHours(row.opening_hours),
    googleRating:
      (kind === "business" || kind === "professional") &&
      row.google_rating != null
        ? Number(row.google_rating)
        : null,
    googleReviewsCount:
      kind === "business" || kind === "professional"
        ? Number(row.google_reviews_count ?? 0)
        : null,
    yelpRating:
      (kind === "business" || kind === "professional") &&
      row.yelp_rating != null
        ? Number(row.yelp_rating)
        : null,
    yelpReviewsCount:
      kind === "business" || kind === "professional"
        ? Number(row.yelp_reviews_count ?? 0)
        : null,
    trustpilotRating:
      (kind === "business" || kind === "professional") &&
      row.trustpilot_rating != null
        ? Number(row.trustpilot_rating)
        : null,
    trustpilotReviewsCount:
      kind === "business" || kind === "professional"
        ? Number(row.trustpilot_reviews_count ?? 0)
        : null,
    facebookRecommendPct:
      (kind === "business" || kind === "professional") &&
      row.facebook_recommend_pct != null
        ? Number(row.facebook_recommend_pct)
        : null,
    facebookReviewsCount:
      kind === "business" || kind === "professional"
        ? Number(row.facebook_reviews_count ?? 0)
        : null,
    services: serviceTitles,
  };
}

async function loadLiveServiceTitles(
  catalog: SupabaseClient,
  kind: "business" | "professional" | "church",
  id: string,
): Promise<string[]> {
  if (kind === "church") return [];
  if (kind === "business") {
    const { data } = await untyped(catalog)
      .from("business_offers")
      .select("title")
      .eq("business_id", id)
      .limit(200);
    return ((data ?? []) as Array<{ title?: string | null }>)
      .map((r) => String(r.title || "").trim())
      .filter(Boolean);
  }
  const { data } = await untyped(catalog)
    .from("professional_services")
    .select("title")
    .eq("professional_id", id)
    .limit(200);
  return ((data ?? []) as Array<{ title?: string | null }>)
    .map((r) => String(r.title || "").trim())
    .filter(Boolean);
}

function mergeContactLinksPatch(
  existingRaw: unknown,
  facebook: string | null | undefined,
  whatsapp: string | null | undefined,
  googleMaps?: string | null | undefined,
  yelp?: string | null | undefined,
  youtube?: string | null | undefined,
  trustpilot?: string | null | undefined,
): ContactLink[] | null {
  if (
    !facebook &&
    !whatsapp &&
    !googleMaps &&
    !yelp &&
    !youtube &&
    !trustpilot
  ) {
    return null;
  }
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
  if (yelp && !byChannel.has("yelp")) {
    byChannel.set("yelp", { channel: "yelp", value: yelp, label: null });
  }
  if (youtube && !byChannel.has("youtube")) {
    byChannel.set("youtube", { channel: "youtube", value: youtube, label: null });
  }
  if (trustpilot && !byChannel.has("trustpilot")) {
    byChannel.set("trustpilot", {
      channel: "trustpilot",
      value: trustpilot,
      label: null,
    });
  }
  return serializeContactLinks([...byChannel.values()]);
}

function liveDbPatch(
  existing: PasteEnrichExisting,
  extracted: PasteEnrichExtracted,
  imageUrl: string | null,
  kind: "business" | "professional" | "church",
  existingContactLinks: unknown,
  applyReplaceKeys: PasteEnrichFieldKey[] = [],
): Record<string, unknown> {
  const logical = pasteEnrichFillEmptyPatch(
    existing,
    extracted,
    imageUrl,
    fillOpts(applyReplaceKeys),
  );
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (logical.name) {
    if (kind === "professional") {
      patch.display_name = logical.name;
    } else {
      patch.name = logical.name;
    }
  }
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
  if (kind === "business" && typeof logical.yelp === "string" && logical.yelp) {
    patch.yelp_url = logical.yelp;
  }
  if (
    kind === "business" &&
    typeof logical.trustpilot === "string" &&
    logical.trustpilot
  ) {
    patch.trustpilot_url = logical.trustpilot;
  }
  if (logical.googleMaps) {
    if (kind === "business" || kind === "church") {
      patch.google_maps_url = logical.googleMaps;
    }
  }
  if (
    (kind === "business" || kind === "professional") &&
    logical.googleRating != null
  ) {
    patch.google_rating = logical.googleRating;
    if (
      typeof logical.googleReviewsCount === "number" &&
      logical.googleReviewsCount > 0
    ) {
      patch.google_reviews_count = logical.googleReviewsCount;
    }
  }
  if (
    (kind === "business" || kind === "professional") &&
    logical.yelpRating != null
  ) {
    patch.yelp_rating = logical.yelpRating;
    if (
      typeof logical.yelpReviewsCount === "number" &&
      logical.yelpReviewsCount > 0
    ) {
      patch.yelp_reviews_count = logical.yelpReviewsCount;
    }
  }
  if (
    (kind === "business" || kind === "professional") &&
    logical.trustpilotRating != null
  ) {
    patch.trustpilot_rating = logical.trustpilotRating;
    if (
      typeof logical.trustpilotReviewsCount === "number" &&
      logical.trustpilotReviewsCount > 0
    ) {
      patch.trustpilot_reviews_count = logical.trustpilotReviewsCount;
    }
  }
  if (
    (kind === "business" || kind === "professional") &&
    logical.facebookRecommendPct != null
  ) {
    patch.facebook_recommend_pct = logical.facebookRecommendPct;
    if (
      typeof logical.facebookReviewsCount === "number" &&
      logical.facebookReviewsCount > 0
    ) {
      patch.facebook_reviews_count = logical.facebookReviewsCount;
    }
  }
  if (logical.city) patch.city = logical.city;
  if (logical.state) {
    const stateCode = toDbStateCode(String(logical.state));
    if (stateCode) patch.state_code = stateCode;
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
      (kind === "professional" || kind === "church") &&
        typeof logical.yelp === "string"
        ? logical.yelp
        : null,
      typeof logical.youtube === "string" ? logical.youtube : null,
      typeof logical.trustpilot === "string" ? logical.trustpilot : null,
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
  applyReplaceKeys: PasteEnrichFieldKey[] = [],
): Record<string, unknown> {
  const logical = pasteEnrichFillEmptyPatch(
    existing,
    extracted,
    imageUrl,
    fillOpts(applyReplaceKeys),
  );
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
  if (typeof logical.yelp === "string" && logical.yelp) {
    const base = Array.isArray(logical.website)
      ? [...logical.website]
      : logical.website
        ? [String(logical.website)]
        : Array.isArray(existing.website)
          ? [...existing.website]
          : existing.website
            ? [String(existing.website)]
            : [];
    const sites = base.filter(Boolean);
    if (!sites.some((u) => /yelp\.com\/biz\//i.test(String(u)))) {
      sites.push(logical.yelp);
    }
    patch.website = sites;
  }
  if (typeof logical.youtube === "string" && logical.youtube) {
    const base = Array.isArray(patch.website)
      ? [...(patch.website as string[])]
      : Array.isArray(logical.website)
        ? [...logical.website]
        : logical.website
          ? [String(logical.website)]
          : Array.isArray(existing.website)
            ? [...existing.website]
            : existing.website
              ? [String(existing.website)]
              : [];
    const sites = base.filter(Boolean);
    if (!sites.some((u) => /youtube\.com|youtu\.be/i.test(String(u)))) {
      sites.push(logical.youtube);
    }
    patch.website = sites;
  }
  if (logical.city) patch.city = logical.city;
  if (logical.state) patch.state = logical.state;
  if (logical.addressLine) patch.address_line = logical.addressLine;
  if (logical.postalCode) patch.postal_code = logical.postalCode;
  if (logical.description) patch.description = logical.description;
  if (logical.imageUrl) patch.preview_image_url = logical.imageUrl;
  if (Array.isArray(logical.services) && logical.services.length > 0) {
    patch.services = logical.services;
  }

  const keys = Object.keys(patch).filter((k) => k !== "updated_at");
  if (keys.length === 0) return {};
  return patch;
}

function filledLabels(patch: Record<string, unknown>): string[] {
  const map: Record<string, string> = {
    business_name: "название",
    name: "название",
    display_name: "название",
    phone: "телефон",
    email: "email",
    website: "сайт",
    instagram: "instagram",
    instagram_url: "instagram",
    telegram_username: "telegram",
    telegram_url: "telegram",
    whatsapp: "whatsapp",
    yelp_url: "Yelp",
    trustpilot_url: "Trustpilot",
    contact_links: "Facebook / WhatsApp / YouTube",
    google_maps_url: "Google Maps",
    google_rating: "Google рейтинг",
    google_reviews_count: "Google отзывы",
    yelp_rating: "Yelp рейтинг",
    yelp_reviews_count: "Yelp отзывы",
    trustpilot_rating: "Trustpilot рейтинг",
    trustpilot_reviews_count: "Trustpilot отзывы",
    facebook_recommend_pct: "Facebook рекомендации",
    facebook_reviews_count: "Facebook отзывы",
    city: "город",
    state: "штат",
    state_code: "штат",
    address_line: "адрес",
    private_address_line: "адрес",
    postal_code: "ZIP",
    latitude: "карта",
    longitude: "карта",
    location_precision: "карта",
    description: "описание",
    opening_hours: "часы работы",
    services: "услуги",
    preview_image_url: "фото",
    image_url: "фото",
    cover_image_url: "фото",
    phones: "телефон",
    websites: "сайт",
    notes: "email",
  };
  return [
    ...new Set(
      Object.keys(patch)
        .filter((k) => k !== "updated_at")
        .map((k) => map[k] || k),
    ),
  ];
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
  const applyReplaceKeys = readApplyReplaceKeys(formData);

  if (
    !id ||
    ![
      "import_review",
      "recommendation",
      "business",
      "professional",
      "church",
    ].includes(kind)
  ) {
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

  // Name is fill-empty on queue and live cards (Google paste → title).
  const extracted = parsePasteEnrichTextWithName(text);

  if (kind === "import_review") {
    const { data: row, error: loadErr } = await untyped(catalog)
      .from("import_review_items")
      .select(
        "id, business_name, phone, email, website, instagram, telegram_username, whatsapp, city, state, address_line, postal_code, description, preview_image_url, services",
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

    const patch = importDbPatch(existing, extracted, imageUrl, applyReplaceKeys);
    // Scrub / peel street even when paste only filled other fields but address exists.
    const streetForClean =
      (typeof patch.address_line === "string"
        ? patch.address_line
        : existing.addressLine) || null;
    if (streetForClean?.trim()) {
      const cleaned = await cleanAdminStreetAddress({
        addressLine: streetForClean,
        city:
          (typeof patch.city === "string" ? patch.city : existing.city) || null,
        stateCode:
          (typeof patch.state === "string" ? patch.state : existing.state) || null,
        postalCode:
          (typeof patch.postal_code === "string"
            ? patch.postal_code
            : existing.postalCode) || null,
      });
      if (cleaned.changed) {
        if (cleaned.addressLine) patch.address_line = cleaned.addressLine;
        if (cleaned.city) patch.city = cleaned.city;
        if (cleaned.stateCode) patch.state = cleaned.stateCode;
        if (cleaned.postalCode) patch.postal_code = cleaned.postalCode;
      }
    }
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

  if (kind === "recommendation") {
    const { data: row, error: loadErr } = await untyped(catalog)
      .from("import_comment_recommendations")
      .select(
        "id, display_name, phones, instagram, websites, notes, city, state_code, address_line, cover_image_url, request_snippets, comment_texts, status",
      )
      .eq("id", id)
      .maybeSingle();
    if (loadErr) return fail(loadErr.message);
    if (!row) return fail("Рекомендация не найдена.");
    if (row.status === "approved" || row.status === "rejected") {
      return fail("Карточка уже обработана.");
    }

    const existing = existingFromRecommendationRow(row as Record<string, unknown>);
    let imageUrl: string | null = null;
    if (file && emptyScalar(existing.imageUrl)) {
      const up = await uploadPasteImage({
        catalog,
        file,
        storagePrefix: `recommendation/${id}`,
      });
      if (!up.ok) return fail(up.message);
      imageUrl = up.imageUrl;
    }

    const patch = recommendationDbPatch(
      existing,
      extracted,
      imageUrl,
      (row.notes as string | null) ?? null,
      applyReplaceKeys,
    );
    const streetForClean =
      (typeof patch.address_line === "string"
        ? patch.address_line
        : existing.addressLine) || null;
    if (streetForClean?.trim()) {
      const cleaned = await cleanAdminStreetAddress(
        {
          addressLine: streetForClean,
          city:
            (typeof patch.city === "string" ? patch.city : existing.city) ||
            null,
          stateCode: existing.state ?? null,
          postalCode: existing.postalCode ?? null,
        },
        { withGeo: true },
      );
      if (cleaned.changed || cleaned.latitude != null) {
        if (cleaned.addressLine) patch.address_line = cleaned.addressLine;
        if (cleaned.city) patch.city = cleaned.city;
        if (cleaned.stateCode) patch.state_code = cleaned.stateCode;
        if (cleaned.latitude != null && cleaned.longitude != null) {
          patch.latitude = cleaned.latitude;
          patch.longitude = cleaned.longitude;
        }
      }
    }
    if (Object.keys(patch).filter((k) => k !== "updated_at").length === 0) {
      return ok(
        "Новых полей нет — всё уже заполнено или в тексте ничего не нашлось.",
        [],
      );
    }

    const { error: updErr } = await untyped(catalog)
      .from("import_comment_recommendations")
      .update(patch)
      .eq("id", id);
    if (updErr) return fail(updErr.message);

    revalidatePath("/admin/recommendations");
    revalidatePath("/admin/review/inbox");
    revalidatePath(
      `/admin/review/${encodeURIComponent(`recommendation:${id}`)}`,
    );
    const filled = filledLabels({
      ...patch,
      // Map array fields to labels used in filledLabels
      phone: patch.phones,
      website: patch.websites,
      preview_image_url: patch.cover_image_url,
    });
    return ok(
      filled.length ? `Добавлено: ${filled.join(", ")}.` : "Готово.",
      filled,
    );
  }

  const table =
    kind === "business"
      ? "businesses"
      : kind === "professional"
        ? "professionals"
        : "churches";
  const selectCols =
    kind === "business"
      ? "id, slug, name, phone, email, website, instagram_url, telegram_url, yelp_url, trustpilot_url, google_maps_url, google_rating, google_reviews_count, yelp_rating, yelp_reviews_count, trustpilot_rating, trustpilot_reviews_count, facebook_recommend_pct, facebook_reviews_count, contact_links, city, state_code, address_line, postal_code, description, short_description, image_url, opening_hours"
      : kind === "professional"
        ? "id, slug, display_name, phone, email, website, instagram_url, telegram_url, google_rating, google_reviews_count, yelp_rating, yelp_reviews_count, trustpilot_rating, trustpilot_reviews_count, facebook_recommend_pct, facebook_reviews_count, contact_links, city, state_code, private_address_line, postal_code, description, short_description, card_summary, image_url, opening_hours"
        : "id, slug, name, phone, email, website, instagram_url, telegram_url, google_maps_url, contact_links, city, state_code, address_line, postal_code, description, image_url, opening_hours, schedule_text, ministries";

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
    await loadLiveServiceTitles(catalog, kind, id),
  );
  let imageUrl: string | null = null;
  if (file && emptyScalar(existing.imageUrl)) {
    const prefix =
      kind === "business"
        ? `covers/${id}`
        : kind === "professional"
          ? `professionals/${id}`
          : `churches/${id}`;
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
    applyReplaceKeys,
  );
  await attachLiveStreetGeo(catalog, id, patch, existing, kind);

  const pricedOffers = (extracted.pricedServices ?? []).map((p) => ({
    title: p.title,
    priceAmount: p.priceAmount,
    priceMode: "fixed" as const,
    priceUnit: p.perHour ? ("hour" as const) : null,
  }));
  const nameOffers = offersFromServiceNames(
    extracted.services.filter(
      (s) =>
        !(extracted.pricedServices ?? []).some(
          (p) => p.title.trim().toLowerCase() === s.trim().toLowerCase(),
        ),
    ),
  );
  const offers = [...pricedOffers, ...nameOffers];
  let servicesAdded = 0;
  if (offers.length > 0 && kind !== "church") {
    servicesAdded =
      kind === "business"
        ? await addMissingBusinessOffers(catalog, id, offers)
        : await addMissingProfessionalServices(catalog, id, offers);
  }

  let menuAdded = 0;
  if (
    kind === "business" &&
    Array.isArray(extracted.menuItems) &&
    extracted.menuItems.length > 0
  ) {
    menuAdded = await addMissingBusinessOffers(
      catalog,
      id,
      menuItemsToImportedOffers(extracted.menuItems),
      { offerType: "menu_item" },
    );
  }

  if (Object.keys(patch).length === 0 && servicesAdded === 0 && menuAdded === 0) {
    return ok(
      "Новых полей нет — всё уже заполнено или в тексте ничего не нашлось.",
      [],
    );
  }

  if (Object.keys(patch).length > 0) {
    const { error: updErr } = await untyped(catalog)
      .from(table)
      .update(patch)
      .eq("id", id);
    if (updErr) return fail(updErr.message);
  }

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
  if (kind === "church" && liveSlug) {
    revalidatePath(`/churches/${liveSlug}`);
    revalidatePath("/admin/catalog/churches");
    revalidatePath("/churches");
  }
  revalidatePath("/search");

  const filled = filledLabels(patch);
  if (servicesAdded > 0) filled.push("услуги");
  if (menuAdded > 0) filled.push(`меню (${menuAdded})`);
  return ok(
    filled.length
      ? kind === "church"
        ? `Добавлено: ${filled.join(", ")}.`
        : `Добавлено: ${filled.join(", ")}. Если появились сайт или соцсети — нажми Обогатить.`
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
        "business_name, phone, email, website, instagram, telegram_username, whatsapp, city, state, address_line, postal_code, description, preview_image_url, services",
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

  if (input.kind === "recommendation") {
    const { data: row, error } = await untyped(catalog)
      .from("import_comment_recommendations")
      .select(
        "display_name, phones, instagram, websites, notes, city, state_code, address_line, cover_image_url, request_snippets, comment_texts",
      )
      .eq("id", input.id)
      .maybeSingle();
    if (error) return { ok: false, message: error.message };
    if (!row) return { ok: false, message: "Не найдено." };
    return {
      ok: true,
      existing: existingFromRecommendationRow(row as Record<string, unknown>),
    };
  }

  const table =
    input.kind === "business"
      ? "businesses"
      : input.kind === "professional"
        ? "professionals"
        : "churches";
  const selectCols =
    input.kind === "business"
      ? "name, phone, email, website, instagram_url, telegram_url, yelp_url, trustpilot_url, google_maps_url, google_rating, google_reviews_count, yelp_rating, yelp_reviews_count, trustpilot_rating, trustpilot_reviews_count, facebook_recommend_pct, facebook_reviews_count, contact_links, city, state_code, address_line, postal_code, latitude, longitude, location_precision, description, short_description, image_url, opening_hours"
      : input.kind === "professional"
        ? "display_name, phone, email, website, instagram_url, telegram_url, google_rating, google_reviews_count, yelp_rating, yelp_reviews_count, trustpilot_rating, trustpilot_reviews_count, facebook_recommend_pct, facebook_reviews_count, contact_links, city, state_code, private_address_line, postal_code, latitude, longitude, location_precision, description, short_description, card_summary, image_url, opening_hours"
        : "name, phone, email, website, instagram_url, telegram_url, google_maps_url, contact_links, city, state_code, address_line, postal_code, latitude, longitude, location_precision, description, image_url, opening_hours, schedule_text, ministries";
  const { data: row, error } = await untyped(catalog)
    .from(table)
    .select(selectCols)
    .eq("id", input.id)
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!row) return { ok: false, message: "Не найдено." };
  const serviceTitles = await loadLiveServiceTitles(
    catalog,
    input.kind,
    input.id,
  );
  return {
    ok: true,
    existing: existingFromLiveRow(
      row as Record<string, unknown>,
      input.kind,
      serviceTitles,
    ),
  };
}

/**
 * Geocode pasted street (and card street when it has no saved pin) before
 * proposing address replace in the paste preview.
 */
export async function evaluatePasteAddressGeoAction(input: {
  existing: PasteEnrichExisting;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}): Promise<
  { ok: true; gate: PasteAddressGeoGate } | { ok: false; message: string }
> {
  const { error: authError } = await requireAdmin();
  if (authError) {
    return { ok: false, message: authError.message };
  }

  const street = (input.addressLine || "").trim();
  if (!street) {
    return { ok: true, gate: { pastedPins: false, cardPins: cardHasStreetPin(input.existing) } };
  }

  const pasted = await resolveStreetGeoFields({
    addressLine: street,
    city: input.city,
    stateCode: input.state,
    postalCode: input.postalCode,
  });
  const pastedPins =
    pasted.location_precision === "street" &&
    pasted.latitude != null &&
    pasted.longitude != null;

  let cardPins = cardHasStreetPin(input.existing);
  if (!cardPins && (input.existing.addressLine || "").trim()) {
    const existingGeo = await resolveStreetGeoFields({
      addressLine: input.existing.addressLine,
      city: input.existing.city,
      stateCode: input.existing.state,
      postalCode: input.existing.postalCode,
    });
    cardPins =
      existingGeo.location_precision === "street" &&
      existingGeo.latitude != null &&
      existingGeo.longitude != null;
  }

  return { ok: true, gate: { pastedPins, cardPins } };
}
