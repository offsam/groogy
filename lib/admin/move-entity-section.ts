"use server";

/**
 * Canonical live-card section move.
 * Generalizes business↔professional reclassify into all platform sections.
 * SoT: docs/architecture/pipeline/ENTITY_SECTION_ROUTING_V1.md
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import { userIsAdmin } from "@/lib/reviews/queries";
import { inferLocationPrecision } from "@/lib/business/location-precision";
import { normalizeStructuredAddress } from "@/lib/address/normalize";
import { resolveStreetGeoFields } from "@/lib/geo/geocode-street";
import {
  isResolvedLocation,
  resolveEntityLocation,
} from "@/lib/geo/resolve-entity-location";
import {
  resolveSourceKind,
  sourceTypeFromKind,
  type SourceKind,
} from "@/lib/business/presence";
import type { PlatformSectionKey } from "@/lib/platform/sections";
import type { Database } from "@/types/database";

export type MoveSectionKey = Exclude<PlatformSectionKey, "vehicles"> | "services";

export type MoveEntitySectionResult =
  | { ok: true; message: string; redirectTo: string; toId: string; toSlug: string }
  | { ok: false; message: string };

type PublishedKind =
  | "business"
  | "professional"
  | "listing"
  | "job"
  | "event"
  | "church";

const SECTION_META: Record<
  MoveSectionKey,
  {
    title: string;
    pathPrefix: string;
    publishedKind: PublishedKind;
    frozen?: boolean;
    freezeReason?: string;
  }
> = {
  businesses: {
    title: "Бизнесы",
    pathPrefix: "/business",
    publishedKind: "business",
  },
  professionals: {
    title: "Специалисты",
    pathPrefix: "/professional",
    publishedKind: "professional",
  },
  marketplace: {
    title: "Купи-продай",
    pathPrefix: "/marketplace",
    publishedKind: "listing",
  },
  jobs: { title: "Работа", pathPrefix: "/jobs", publishedKind: "job" },
  events: { title: "События", pathPrefix: "/events", publishedKind: "event" },
  lechu: { title: "Лечу", pathPrefix: "/lechu", publishedKind: "listing" },
  transfers: {
    title: "Переводы",
    pathPrefix: "/transfers",
    publishedKind: "listing",
  },
  services: {
    title: "Услуги",
    pathPrefix: "/business",
    publishedKind: "business",
  },
  real_estate: {
    title: "Недвижимость",
    pathPrefix: "/real-estate",
    publishedKind: "listing",
    frozen: true,
    freezeReason: "Таблица недвижимости заморожена (Phase 3).",
  },
  churches: {
    title: "Церкви",
    pathPrefix: "/churches",
    publishedKind: "church",
  },
};

function fail(message: string): MoveEntitySectionResult {
  return { ok: false, message };
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t || null;
}

function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return s || "card";
}

type Untyped = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic table client
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

function db(client: SupabaseClient): Untyped {
  return client as unknown as Untyped;
}

async function requireAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, user: null, error: fail("Нужно войти в аккаунт.") };
  }
  if (!(await userIsAdmin(supabase))) {
    return {
      supabase,
      user,
      error: fail("Только для администраторов."),
    };
  }
  return { supabase, user, error: null as null };
}

async function uniqueSlug(
  table: string,
  base: string,
  catalog: Untyped,
): Promise<string> {
  const root = base.slice(0, 50) || "card";
  for (let n = 0; n < 40; n++) {
    const candidate = n === 0 ? root : `${root}-${n + 1}`;
    const { data } = await catalog
      .from(table)
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

type SourceCard = {
  kind: PublishedKind;
  id: string;
  slug: string;
  path: string;
  name: string;
  description: string | null;
  shortDescription: string | null;
  imageUrl: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  instagramUrl: string | null;
  telegramUrl: string | null;
  city: string | null;
  region: string | null;
  stateCode: string | null;
  postalCode: string | null;
  addressLine: string | null;
  latitude: number | null;
  longitude: number | null;
  sourceUrl: string | null;
  sourceKind: SourceKind;
  categoryId: string | null;
  price: number | null;
  currency: string | null;
  reviewCount: number;
  googleMapsUrl?: string | null;
  contactLinks?: unknown;
};

/** USA Location Canon — re-resolve on section move (never trust stale hub region). */
async function resolveLocationForMove(source: SourceCard): Promise<{
  city: string | null;
  region: string | null;
  stateCode: string | null;
  postalCode: string | null;
  countyGeoid: string | null;
  locationPrecision: "street" | "city" | "county" | "approx" | null;
}> {
  const { url, anonKey } = getPublicSupabaseEnv();
  const geoClient = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await resolveEntityLocation(geoClient, {
    city: source.city,
    region: source.region,
    stateCode: source.stateCode,
    postalCode: source.postalCode,
    source: source.sourceUrl,
    text: [source.name, source.shortDescription, source.description]
      .filter(Boolean)
      .join("\n"),
  });

  if (isResolvedLocation(result)) {
    const street = source.addressLine?.trim() || null;
    return {
      city: result.city,
      region: result.region,
      stateCode: result.stateCode,
      postalCode: result.postalCode,
      countyGeoid: result.countyGeoid,
      locationPrecision: street
        ? inferLocationPrecision({
            addressLine: street,
            city: result.city,
            region: result.region,
          })
        : result.city
          ? "city"
          : result.region
            ? "county"
            : null,
    };
  }

  return {
    city: source.city,
    region: source.region,
    stateCode: source.stateCode,
    postalCode: source.postalCode,
    countyGeoid: null,
    locationPrecision: source.addressLine
      ? inferLocationPrecision({
          addressLine: source.addressLine,
          city: source.city,
          region: source.region,
        })
      : null,
  };
}

async function loadSource(
  catalog: Untyped,
  fromSection: MoveSectionKey,
  fromId: string,
): Promise<SourceCard | { error: string }> {
  const meta = SECTION_META[fromSection];
  if (meta.publishedKind === "business") {
    const { data, error } = await catalog
      .from("businesses")
      .select(
        "id, name, slug, short_description, description, image_url, phone, email, website, city, region, state_code, postal_code, address_line, latitude, longitude, instagram_url, telegram_url, source_url, source_kind, category_id, status, reviews_count, google_maps_url, contact_links",
      )
      .eq("id", fromId)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: "Бизнес не найден." };
    if (data.status === "archived") return { error: "Карточка уже в архиве." };
    return {
      kind: "business",
      id: data.id,
      slug: data.slug,
      path: `/business/${data.slug}`,
      name: data.name,
      description: data.description,
      shortDescription: data.short_description,
      imageUrl: data.image_url,
      phone: data.phone,
      email: data.email,
      website: data.website,
      instagramUrl: data.instagram_url,
      telegramUrl: data.telegram_url,
      city: data.city,
      region: data.region,
      stateCode: data.state_code,
      postalCode: data.postal_code,
      addressLine: data.address_line,
      latitude:
        typeof data.latitude === "number" ? data.latitude : null,
      longitude:
        typeof data.longitude === "number" ? data.longitude : null,
      sourceUrl: data.source_url,
      sourceKind: resolveSourceKind(data.source_url, data.source_kind),
      categoryId: data.category_id,
      price: null,
      currency: null,
      reviewCount: Number(data.reviews_count ?? 0),
      googleMapsUrl: data.google_maps_url ?? null,
      contactLinks: data.contact_links ?? [],
    };
  }

  if (meta.publishedKind === "professional") {
    const { data, error } = await catalog
      .from("professionals")
      .select(
        "id, display_name, slug, short_description, description, headline, image_url, phone, email, website, city, region, state_code, postal_code, private_address_line, latitude, longitude, instagram_url, telegram_url, source_url, source_type, category_id, status",
      )
      .eq("id", fromId)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: "Специалист не найден." };
    if (data.status === "archived") return { error: "Карточка уже в архиве." };
    return {
      kind: "professional",
      id: data.id,
      slug: data.slug,
      path: `/professional/${data.slug}`,
      name: data.display_name,
      description: data.description,
      shortDescription: data.short_description || data.headline,
      imageUrl: data.image_url,
      phone: data.phone,
      email: data.email,
      website: data.website,
      instagramUrl: data.instagram_url,
      telegramUrl: data.telegram_url,
      city: data.city,
      region: data.region,
      stateCode: data.state_code,
      postalCode: data.postal_code,
      addressLine: data.private_address_line,
      latitude:
        typeof data.latitude === "number" ? data.latitude : null,
      longitude:
        typeof data.longitude === "number" ? data.longitude : null,
      sourceUrl: data.source_url,
      sourceKind: resolveSourceKind(data.source_url, data.source_type),
      categoryId: data.category_id,
      price: null,
      currency: null,
      reviewCount: 0,
    };
  }

  if (meta.publishedKind === "church") {
    const { data, error } = await catalog
      .from("churches")
      .select(
        "id, name, slug, description, image_url, phone, email, website, city, region, state_code, postal_code, address_line, latitude, longitude, instagram_url, telegram_url, source_url, source_kind, status, google_maps_url, contact_links",
      )
      .eq("id", fromId)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: "Церковь не найдена." };
    if (data.status === "archived") return { error: "Карточка уже в архиве." };
    return {
      kind: "church",
      id: data.id,
      slug: data.slug,
      path: `/churches/${data.slug}`,
      name: data.name,
      description: data.description,
      shortDescription: (data.description || "").slice(0, 280),
      imageUrl: data.image_url,
      phone: data.phone,
      email: data.email,
      website: data.website,
      instagramUrl: data.instagram_url,
      telegramUrl: data.telegram_url,
      city: data.city,
      region: data.region,
      stateCode: data.state_code,
      postalCode: data.postal_code,
      addressLine: data.address_line,
      latitude:
        typeof data.latitude === "number" ? data.latitude : null,
      longitude:
        typeof data.longitude === "number" ? data.longitude : null,
      sourceUrl: data.source_url,
      sourceKind: resolveSourceKind(data.source_url, data.source_kind),
      categoryId: null,
      price: null,
      currency: null,
      reviewCount: 0,
      googleMapsUrl: data.google_maps_url ?? null,
      contactLinks: data.contact_links ?? [],
    };
  }

  if (meta.publishedKind === "listing") {
    const { data, error } = await catalog
      .from("listings")
      .select(
        "id, title, description, status, listing_type, price_amount, price_currency, city, state, state_code, source_url, source_kind",
      )
      .eq("id", fromId)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: "Объявление не найдено." };
    if (data.status === "archived" || data.status === "removed") {
      return { error: "Карточка уже в архиве." };
    }
    const prefix =
      data.listing_type === "transport_carry"
        ? "/lechu"
        : data.listing_type === "transfer"
          ? "/transfers"
          : "/marketplace";
    return {
      kind: "listing",
      id: data.id,
      slug: data.id,
      path: `${prefix}/${data.id}`,
      name: data.title,
      description: data.description,
      shortDescription: (data.description || "").slice(0, 280),
      imageUrl: null,
      phone: null,
      email: null,
      website: null,
      instagramUrl: null,
      telegramUrl: null,
      city: data.city,
      region: data.state,
      stateCode: data.state_code,
      postalCode: null,
      addressLine: null,
      latitude: null,
      longitude: null,
      sourceUrl: data.source_url,
      sourceKind: resolveSourceKind(data.source_url, data.source_kind),
      categoryId: null,
      price: data.price_amount == null ? null : Number(data.price_amount),
      currency: data.price_currency,
      reviewCount: 0,
    };
  }

  if (meta.publishedKind === "job") {
    const { data, error } = await catalog
      .from("jobs")
      .select(
        "id, title, slug, description, status, city, state_code, postal_code, source_url, source_type",
      )
      .eq("id", fromId)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: "Вакансия не найдена." };
    if (data.status === "archived") return { error: "Карточка уже в архиве." };
    return {
      kind: "job",
      id: data.id,
      slug: data.slug,
      path: `/jobs/${data.slug}`,
      name: data.title,
      description: data.description,
      shortDescription: (data.description || "").slice(0, 280),
      imageUrl: null,
      phone: null,
      email: null,
      website: null,
      instagramUrl: null,
      telegramUrl: null,
      city: data.city,
      region: null,
      stateCode: data.state_code,
      postalCode: data.postal_code,
      addressLine: null,
      latitude: null,
      longitude: null,
      sourceUrl: data.source_url,
      sourceKind: resolveSourceKind(data.source_url, data.source_type),
      categoryId: null,
      price: null,
      currency: null,
      reviewCount: 0,
    };
  }

  // event
  const { data, error } = await catalog
    .from("events")
    .select(
      "id, title, slug, description, status, city, state_code, address_line, cover_image_url, source_url, source_channel, phone, telegram_url, price_label, latitude, longitude",
    )
    .eq("id", fromId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Событие не найдено." };
  if (data.status === "archived") return { error: "Карточка уже в архиве." };
  return {
    kind: "event",
    id: data.id,
    slug: data.slug,
    path: `/events/${data.slug}`,
    name: data.title,
    description: data.description,
    shortDescription: (data.description || "").slice(0, 280),
    imageUrl: data.cover_image_url,
    phone: data.phone,
    email: null,
    website: null,
    instagramUrl: null,
    telegramUrl: data.telegram_url,
    city: data.city,
    region: null,
    stateCode: data.state_code,
    postalCode: null,
    addressLine: data.address_line,
    latitude:
      typeof data.latitude === "number" ? data.latitude : null,
    longitude:
      typeof data.longitude === "number" ? data.longitude : null,
    sourceUrl: data.source_url,
    sourceKind: resolveSourceKind(data.source_url, data.source_channel),
    categoryId: null,
    price: null,
    currency: null,
    reviewCount: 0,
  };
}

async function retargetSoftRefs(
  catalog: Untyped,
  fromKind: PublishedKind,
  fromId: string,
  toKind: PublishedKind,
  toId: string,
) {
  await catalog
    .from("import_review_items")
    .update({
      published_entity_type: toKind,
      published_entity_id: toId,
    })
    .eq("published_entity_type", fromKind)
    .eq("published_entity_id", fromId);

  try {
    await catalog
      .from("import_comment_recommendations")
      .update({
        published_entity_type: toKind,
        published_entity_id: toId,
      })
      .eq("published_entity_type", fromKind)
      .eq("published_entity_id", fromId);
  } catch {
    /* table may not exist in all envs */
  }

  try {
    await catalog
      .from("entity_promotions")
      .update({ owner_type: toKind, owner_id: toId })
      .eq("owner_type", fromKind)
      .eq("owner_id", fromId);
  } catch {
    /* optional */
  }

  try {
    await catalog
      .from("entity_enrich_runs")
      .update({ entity_kind: toKind, entity_id: toId })
      .eq("entity_kind", fromKind)
      .eq("entity_id", fromId);
  } catch {
    /* optional */
  }
}

async function archiveSource(
  supabase: SupabaseClient,
  catalog: Untyped,
  source: SourceCard,
): Promise<string | null> {
  if (source.kind === "business") {
    const { error } = await supabase.rpc("admin_set_business_status", {
      p_business_id: source.id,
      p_status: "archived",
    });
    return error?.message ?? null;
  }
  if (source.kind === "professional") {
    const { error } = await catalog
      .from("professionals")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", source.id);
    return error?.message ?? null;
  }
  if (source.kind === "listing") {
    const { error } = await supabase.rpc("admin_set_listing_status", {
      p_listing_id: source.id,
      p_status: "archived",
    });
    return error?.message ?? null;
  }
  if (source.kind === "job") {
    const { error } = await catalog
      .from("jobs")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", source.id);
    return error?.message ?? null;
  }
  if (source.kind === "church") {
    const { error } = await catalog
      .from("churches")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", source.id);
    return error?.message ?? null;
  }
  const { error } = await catalog
    .from("events")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", source.id);
  return error?.message ?? null;
}

/**
 * Move a published card from one platform section to another.
 * Creates the target row, retargets soft refs, archives the source, writes entity_moves.
 */
export async function moveEntitySectionAction(input: {
  fromSection: MoveSectionKey;
  fromId: string;
  toSection: MoveSectionKey;
  reason?: string | null;
}): Promise<MoveEntitySectionResult> {
  const { supabase, user, error } = await requireAdmin();
  if (error) return error;
  if (!user) return fail("Нужно войти в аккаунт.");

  const fromMeta = SECTION_META[input.fromSection];
  const toMeta = SECTION_META[input.toSection];
  if (!fromMeta || !toMeta) return fail("Неизвестный раздел.");
  if (input.fromSection === input.toSection) {
    return fail("Карточка уже в этом разделе.");
  }
  if (toMeta.frozen) {
    return fail(toMeta.freezeReason || "Раздел пока недоступен.");
  }

  const catalog = db(createServiceRoleClient());
  const source = await loadSource(catalog, input.fromSection, input.fromId);
  if ("error" in source) return fail(source.error);

  // If the live row lost provenance (common: business approve can't UPDATE
  // source_url under authenticated column grants), recover from the linked
  // recommendation before copying into the target section.
  if (!source.sourceUrl?.trim()) {
    try {
      const { data: rec } = await catalog
        .from("import_comment_recommendations")
        .select("source_post_urls, directory_source, source_channel")
        .eq("published_entity_id", source.id)
        .limit(1)
        .maybeSingle();
      const recovered = Array.isArray(rec?.source_post_urls)
        ? String(rec.source_post_urls[0] || "").trim()
        : "";
      if (recovered) {
        source.sourceUrl = recovered;
        source.sourceKind = resolveSourceKind(
          recovered,
          rec?.directory_source || rec?.source_channel,
        );
      }
    } catch {
      /* recommendations table may be absent */
    }
  }

  // Reviews only attach to businesses — block silent loss.
  if (
    source.kind === "business" &&
    source.reviewCount > 0 &&
    toMeta.publishedKind !== "business"
  ) {
    return fail(
      `У карточки ${source.reviewCount} отзыв(ов). Переезд из Бизнесов с отзывами пока заблокирован — отзывы нельзя молча потерять.`,
    );
  }

  const name = source.name.trim() || "Карточка";
  const baseSlug =
    source.slug &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(source.slug) &&
    source.slug.length >= 3
      ? source.slug
      : slugify(name);

  const loc = await resolveLocationForMove(source);
  const peeled = normalizeStructuredAddress({
    addressLine: source.addressLine,
    city: loc.city || source.city,
    region: loc.region || source.region,
    stateCode: loc.stateCode || source.stateCode,
    postalCode: loc.postalCode || source.postalCode,
    businessName: source.name,
  });
  const streetForPin = peeled.addressLine || source.addressLine;
  const geo = await resolveStreetGeoFields({
    addressLine: streetForPin,
    city: peeled.city || loc.city,
    stateCode: peeled.stateCode || loc.stateCode,
    postalCode: peeled.postalCode || loc.postalCode,
    region: peeled.region || loc.region,
  });
  const moveCity = peeled.city || loc.city;
  const moveRegion = peeled.region || loc.region;
  const moveState = peeled.stateCode || loc.stateCode;
  const moveZip = peeled.postalCode || loc.postalCode || geo.postalCode || null;
  const moveStreet = geo.addressLine || peeled.addressLine || source.addressLine;
  const moveLat = geo.latitude ?? source.latitude;
  const moveLng = geo.longitude ?? source.longitude;
  const movePrecision =
    geo.location_precision ||
    (moveLat != null && moveLng != null && moveStreet
      ? "street"
      : loc.locationPrecision);

  let toId = "";
  let toSlug = "";
  let toPath = "";

  try {
    if (toMeta.publishedKind === "professional") {
      toSlug = await uniqueSlug("professionals", baseSlug, catalog);
      const { data, error: insertError } = await catalog
        .from("professionals")
        .insert({
          owner_profile_id: null,
          created_by_profile_id: user.id,
          source_type: sourceTypeFromKind(source.sourceKind),
          source_record_id: source.id,
          source_url: source.sourceUrl,
          imported_at: new Date().toISOString(),
          import_batch_id: "admin_section_move_v1",
          display_name: name.slice(0, 120),
          slug: toSlug,
          headline: null,
          short_description: null,
          description: source.description,
          image_url: source.imageUrl,
          status: "approved",
          visibility: "public",
          city: moveCity,
          region: moveRegion,
          state_code: moveState,
          postal_code: moveZip,
          county_geoid: loc.countyGeoid,
          private_address_line: moveStreet,
          public_exact_address: false,
          location_precision: movePrecision,
          latitude: moveLat,
          longitude: moveLng,
          phone: source.phone,
          email: source.email,
          website: source.website,
          instagram_url: source.instagramUrl,
          telegram_url: source.telegramUrl,
          category_id: source.categoryId,
          published_at: new Date().toISOString(),
        })
        .select("id, slug")
        .single();
      if (insertError || !data) {
        return fail(insertError?.message || "Не удалось создать специалиста.");
      }
      toId = data.id;
      toSlug = data.slug;
      toPath = `/professional/${toSlug}`;
    } else if (toMeta.publishedKind === "business") {
      toSlug = await uniqueSlug("businesses", baseSlug, catalog);
      const { data: businessId, error: upsertError } = await supabase.rpc(
        "admin_upsert_business",
        {
          p_id: null,
          p_name: name,
          p_slug: toSlug,
          p_short_description: null,
          p_description: source.description,
          p_phone: source.phone,
          p_website: source.website,
          p_city: moveCity ?? "",
          p_address_line: moveStreet,
          p_status: "approved",
          p_category_id: source.categoryId,
        },
      );
      if (upsertError || !businessId) {
        return fail(upsertError?.message || "Не удалось создать бизнес.");
      }
      toId = String(businessId);
      await catalog
        .from("businesses")
        .update({
          region: moveRegion,
          state_code: moveState,
          postal_code: moveZip,
          county_geoid: loc.countyGeoid,
          location_precision: movePrecision,
          location_source: loc.countyGeoid ? "city" : null,
          address_line: moveStreet,
          latitude: moveLat,
          longitude: moveLng,
          image_url: source.imageUrl,
          instagram_url: source.instagramUrl,
          telegram_url: source.telegramUrl,
          source_url: source.sourceUrl,
          source_kind: source.sourceKind,
          ...(geo.google_maps_url
            ? { google_maps_url: geo.google_maps_url }
            : {}),
        })
        .eq("id", toId);
      toPath = `/business/${toSlug}`;
    } else if (toMeta.publishedKind === "listing") {
      const listingType =
        input.toSection === "lechu"
          ? "transport_carry"
          : input.toSection === "transfers"
            ? "transfer"
            : "marketplace_item";
      const description =
        (source.description || source.shortDescription || source.name || "").trim();
      if (description.length < 10) {
        return fail(
          "Для раздела объявлений нужно описание не короче 10 символов.",
        );
      }
      const { data, error: insertError } = await catalog
        .from("listings")
        .insert({
          // Section move of imported cards stays unowned until claimed.
          owner_id: null,
          listing_type: listingType,
          status: "draft",
          visibility: "public",
          title: name.slice(0, 120),
          description: description.slice(0, 8000),
          price_amount: source.price,
          price_currency: (source.currency || "USD").toUpperCase(),
          city: loc.city,
          state: loc.region,
          state_code: loc.stateCode,
          source_url: source.sourceUrl,
          source_kind: source.sourceKind,
          publisher_type: "profile",
        })
        .select("id")
        .single();
      if (insertError || !data) {
        return fail(insertError?.message || "Не удалось создать объявление.");
      }
      toId = data.id;
      toSlug = data.id;
      const { error: activateError } = await supabase.rpc(
        "admin_set_listing_status",
        { p_listing_id: toId, p_status: "active" },
      );
      if (activateError) {
        return fail(activateError.message);
      }
      toPath = `${toMeta.pathPrefix}/${toId}`;
    } else if (toMeta.publishedKind === "job") {
      toSlug = await uniqueSlug("jobs", baseSlug, catalog);
      const { data, error: insertError } = await catalog
        .from("jobs")
        .insert({
          title: name.slice(0, 160),
          slug: toSlug,
          description: source.description || source.shortDescription,
          status: "published",
          visibility: "public",
          source_type: sourceTypeFromKind(source.sourceKind),
          source_url: source.sourceUrl,
          city: loc.city,
          state_code: loc.stateCode,
          postal_code: loc.postalCode,
          published_at: new Date().toISOString(),
        })
        .select("id, slug")
        .single();
      if (insertError || !data) {
        return fail(insertError?.message || "Не удалось создать вакансию.");
      }
      toId = data.id;
      toSlug = data.slug;
      toPath = `/jobs/${toSlug}`;
    } else if (toMeta.publishedKind === "church") {
      toSlug = await uniqueSlug("churches", baseSlug, catalog);
      const churchSourceKind =
        source.sourceKind === "telegram" ||
        source.sourceKind === "facebook" ||
        source.sourceKind === "directory" ||
        source.sourceKind === "platform"
          ? source.sourceKind
          : source.sourceUrl
            ? "directory"
            : "platform";
      const { data, error: insertError } = await catalog
        .from("churches")
        .insert({
          name: name.slice(0, 200),
          slug: toSlug,
          description: source.description || source.shortDescription,
          image_url: source.imageUrl,
          status: "approved",
          address_line: source.addressLine,
          city: loc.city,
          state_code: loc.stateCode,
          postal_code: loc.postalCode,
          region: loc.region,
          county_geoid: loc.countyGeoid,
          latitude: source.latitude,
          longitude: source.longitude,
          location_precision: loc.locationPrecision,
          phone: source.phone,
          email: source.email,
          website: source.website,
          instagram_url: source.instagramUrl,
          telegram_url: source.telegramUrl,
          google_maps_url: source.googleMapsUrl ?? null,
          contact_links: source.contactLinks ?? [],
          source_url: source.sourceUrl,
          source_kind: churchSourceKind,
          published_at: new Date().toISOString(),
        })
        .select("id, slug")
        .single();
      if (insertError || !data) {
        return fail(insertError?.message || "Не удалось создать церковь.");
      }
      toId = data.id;
      toSlug = data.slug;
      toPath = `/churches/${toSlug}`;
    } else {
      // event
      toSlug = await uniqueSlug("events", baseSlug, catalog);
      const { data, error: insertError } = await catalog
        .from("events")
        .insert({
          title: name.slice(0, 200),
          slug: toSlug,
          description: source.description || source.shortDescription,
          status: "published",
          city: loc.city,
          state_code: loc.stateCode,
          address_line: source.addressLine,
          cover_image_url: source.imageUrl,
          source_url: source.sourceUrl,
          phone: source.phone,
          telegram_url: source.telegramUrl,
        })
        .select("id, slug")
        .single();
      if (insertError || !data) {
        return fail(insertError?.message || "Не удалось создать событие.");
      }
      toId = data.id;
      toSlug = data.slug;
      toPath = `/events/${toSlug}`;
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Ошибка создания карточки.");
  }

  await retargetSoftRefs(
    catalog,
    source.kind,
    source.id,
    toMeta.publishedKind,
    toId,
  );

  const archiveError = await archiveSource(supabase, catalog, source);
  if (archiveError) {
    return fail(`Цель создана, но архив источника не удался: ${archiveError}`);
  }

  await catalog.from("entity_moves").insert({
    from_type: source.kind,
    from_id: source.id,
    from_slug: source.slug,
    from_path: source.path,
    to_type: toMeta.publishedKind,
    to_id: toId,
    to_slug: toSlug,
    to_path: toPath,
    moved_by: user.id,
    reason: input.reason?.trim() || `move:${input.fromSection}->${input.toSection}`,
  });

  try {
    await catalog.rpc("emit_domain_event", {
      p_event_type: "entity.reclassified",
      p_entity_type: toMeta.publishedKind,
      p_entity_id: toId,
      p_payload: {
        from_type: source.kind,
        from_id: source.id,
        from_path: source.path,
        to_type: toMeta.publishedKind,
        to_id: toId,
        to_path: toPath,
        from_section: input.fromSection,
        to_section: input.toSection,
      },
    });
  } catch {
    /* emit is best-effort */
  }

  revalidatePath(source.path);
  revalidatePath(toPath);
  revalidatePath("/admin");
  revalidatePath("/search");
  revalidatePath("/professionals");
  revalidatePath("/marketplace");
  revalidatePath("/jobs");
  revalidatePath("/events");
  revalidatePath("/lechu");
  revalidatePath("/transfers");
  revalidatePath("/churches");
  revalidatePath("/admin/catalog/churches");

  return {
    ok: true,
    message: `Карточка перенесена в «${toMeta.title}».`,
    redirectTo: toPath,
    toId,
    toSlug,
  };
}

/** Backward-compatible wrappers used by older call sites. */
export async function adminReclassifyBusinessToProfessionalAction(input: {
  businessId: string;
}): Promise<MoveEntitySectionResult> {
  return moveEntitySectionAction({
    fromSection: "businesses",
    fromId: input.businessId,
    toSection: "professionals",
    reason: "legacy:business_to_professional",
  });
}

export async function adminReclassifyProfessionalToBusinessAction(input: {
  professionalId: string;
}): Promise<MoveEntitySectionResult> {
  return moveEntitySectionAction({
    fromSection: "professionals",
    fromId: input.professionalId,
    toSection: "businesses",
    reason: "legacy:professional_to_business",
  });
}
