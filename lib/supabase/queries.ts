import { unstable_cache } from "next/cache";
import { computePresenceFlags, type BusinessPresenceFlags } from "@/lib/business/presence-flags";
import { resolvePublicCityPostal } from "@/lib/address/normalize";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Business, BusinessSearchParams, Category } from "@/types/business";
import type { BusinessWithCategory, Database, ProfileRow } from "@/types/database";
import { hasCoordinates } from "@/types/business";
import {
  mapBusinessDetail,
  mapBusinessList,
  mapCategory,
} from "@/lib/supabase/mappers";
import {
  CATALOG_CACHE_TAGS,
  CATALOG_CACHE_TTL,
  ENTITY_DETAIL_TTL,
  businessDetailTag,
} from "@/lib/platform/catalog-cache";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  getRegionHubsByIds,
  locationFieldsMatchHub,
  parseHubIds,
  type RegionHub,
  type RegionMapBounds,
} from "@/lib/regions/hubs";
import { ENTITY_DESCRIPTION_ORIGINAL_READY } from "@/lib/content/description-original";
import { CONTACT_LINKS_COLUMN_READY } from "@/lib/contacts/channels";
import { expandSearchToken, haystackMatchesToken } from "@/lib/search/synonyms";
import { distanceKm } from "@/lib/geo/distance";
import { compareBusinessesByCompleteness } from "@/lib/business/completeness";
import { normalizeRouteSlug } from "@/lib/routing/normalize-route-slug";
import { PROFESSIONAL_CATEGORY_SLUGS } from "@/lib/professional/categories";
import { normalizeUsStateCode } from "@/lib/geo/us-state-centroids";
import { reconcileStateCode } from "@/lib/geo/us-zip-state";

type Client = SupabaseClient<Database>;

/** Full row — owners, profile detail, contacts API. */
const BUSINESS_DETAIL_SELECT_BASE: string = `
  id,
  slug,
  category_id,
  name,
  short_description,
  description,
  status,
  rating_avg,
  reviews_count,
  ai_verified_reviews_count,
  transaction_verified_reviews_count,
  phone,
  email,
  website,
  instagram_url,
  telegram_url,
  source_url,
  source_kind,
  yelp_url,
  yelp_rating,
  yelp_reviews_count,
  trustpilot_url,
  trustpilot_rating,
  trustpilot_reviews_count,
  facebook_recommend_pct,
  facebook_reviews_count,
  instagram_followers_count,
  google_maps_url,
  google_rating,
  google_reviews_count,
  booking_url,
  payment_methods,
  image_url,
  address_line,
  city,
  region,
  state_code,
  city_geoid,
  postal_code,
  latitude,
  longitude,
  location_precision,
  opening_hours,
  created_at,
  updated_at,
  third_party_mention_count,
  self_ad_mention_count,
  categories (
    id,
    slug,
    name,
    icon
  )
`;

const BUSINESS_DETAIL_SELECT = (() => {
  const extras: string[] = [];
  if (CONTACT_LINKS_COLUMN_READY) extras.push("contact_links");
  if (ENTITY_DESCRIPTION_ORIGINAL_READY) extras.push("description_original");
  if (extras.length === 0) return BUSINESS_DETAIL_SELECT_BASE;
  // Insert before the nested `categories (...)` block.
  const marker = "categories (";
  const idx = BUSINESS_DETAIL_SELECT_BASE.lastIndexOf(marker);
  if (idx < 0) {
    return `${BUSINESS_DETAIL_SELECT_BASE},\n  ${extras.join(",\n  ")}`;
  }
  return `${BUSINESS_DETAIL_SELECT_BASE.slice(0, idx)}${extras.join(",\n  ")},\n  ${BUSINESS_DETAIL_SELECT_BASE.slice(idx)}`;
})();

/**
 * List select still reads contact columns on the server so we can compute
 * presence flags, then mapBusinessList strips plaintext before any response.
 */
const BUSINESS_LIST_SELECT = BUSINESS_DETAIL_SELECT;

function escapeIlike(value: string): string {
  return value.replace(/[%_]/g, "\\$&");
}

/** Split free-text into safe search tokens (no punctuation that breaks PostgREST filters). */
function searchTokens(query: string): string[] {
  const stop = new Set([
    "в",
    "на",
    "и",
    "или",
    "с",
    "по",
    "для",
    "из",
    "у",
    "о",
    "об",
    "а",
    "но",
    "же",
    "ли",
    "бы",
    "к",
    "ко",
    "от",
    "до",
    "за",
    "со",
    "это",
    "как",
    "что",
    "кто",
    "где",
    "который",
    "которая",
    "которое",
    "которые",
    "нужен",
    "нужна",
    "нужно",
    "найди",
    "найти",
    "ищу",
    "хочу",
    "есть",
    "the",
    "a",
    "an",
    "and",
    "or",
    "in",
    "on",
    "for",
    "to",
    "of",
    "with",
    "near",
  ]);

  return query
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !stop.has(t.toLowerCase()));
}

export async function getActiveCategories(client: Client): Promise<Category[]> {
  const { data, error } = await client
    .from("categories")
    .select("*")
    .eq("is_active", true)
    .eq("domain", "business")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? []).map(mapCategory);
}

/** Categories used on /professionals — only professional sphere slugs (not business «Рестораны» etc.). */
export async function getProfessionalCategories(
  client: Client,
): Promise<Category[]> {
  const { data, error } = await client
    .from("categories")
    .select("*")
    .eq("is_active", true)
    .in("slug", [...PROFESSIONAL_CATEGORY_SLUGS])
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? []).map(mapCategory);
}

export async function getApprovedBusinesses(
  client: Client,
  limit = 50,
): Promise<Business[]> {
  const { data, error } = await client
    .from("businesses")
    .select(BUSINESS_LIST_SELECT)
    .eq("status", "approved")
    .order("rating_avg", { ascending: false })
    .order("name", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as unknown as BusinessWithCategory[]).map(mapBusinessList);
}

/** Newest + popular businesses with coordinates for the home activity map. */
/** Home map pin — business or professional with an address + coordinates. */
export type HomeMapPin = {
  id: string;
  kind: "business" | "professional" | "church";
  name: string;
  slug: string;
  href: string;
  city: string | null;
  /** ISO 3166-2, e.g. US-CA — used for state cluster circles. */
  stateCode: string | null;
  postalCode: string | null;
  latitude: number;
  longitude: number;
  createdAt: string | null;
  /** Listing-card preview fields */
  imageUrl: string | null;
  categoryName: string | null;
  shortDescription: string | null;
  description: string | null;
  ratingAvg: number;
  reviewsCount: number;
  googleRating: number | null;
  googleReviewsCount: number;
  yelpRating: number | null;
  yelpReviewsCount: number;
  trustpilotRating: number | null;
  trustpilotReviewsCount: number;
  facebookRecommendPct: number | null;
  facebookReviewsCount: number;
  instagramFollowersCount: number | null;
  presenceFlags: BusinessPresenceFlags;
};

const HOME_MAP_BUSINESS_SELECT =
  "id, slug, name, city, state_code, postal_code, latitude, longitude, address_line, created_at, image_url, short_description, description, rating_avg, reviews_count, google_rating, google_reviews_count, yelp_rating, yelp_reviews_count, trustpilot_rating, trustpilot_reviews_count, facebook_recommend_pct, facebook_reviews_count, instagram_followers_count, phone, email, website, instagram_url, telegram_url, source_url, source_kind, yelp_url, trustpilot_url, google_maps_url, categories(name)" as const;

const HOME_MAP_PROFESSIONAL_SELECT =
  "id, slug, display_name, city, state_code, latitude, longitude, private_address_line, created_at, image_url, headline, short_description, rating_avg, reviews_count, phone, email, website, instagram_url, categories(name)" as const;

const HOME_MAP_CHURCH_SELECT =
  "id, slug, name, city, state_code, postal_code, latitude, longitude, address_line, created_at, image_url, description" as const;

type HomeMapChurchRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  state_code: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  address_line: string | null;
  created_at: string | null;
  image_url: string | null;
  description: string | null;
};

type HomeMapBusinessRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  state_code: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  address_line: string | null;
  created_at: string | null;
  image_url: string | null;
  short_description: string | null;
  description: string | null;
  rating_avg: number | null;
  reviews_count: number | null;
  google_rating: number | null;
  google_reviews_count: number | null;
  yelp_rating: number | null;
  yelp_reviews_count: number | null;
  instagram_followers_count: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  instagram_url: string | null;
  telegram_url: string | null;
  source_url: string | null;
  source_kind: string | null;
  yelp_url: string | null;
  google_maps_url: string | null;
  categories: { name: string } | { name: string }[] | null;
};

type HomeMapProfessionalRow = {
  id: string;
  slug: string;
  display_name: string;
  city: string | null;
  state_code: string | null;
  latitude: number | null;
  longitude: number | null;
  private_address_line: string | null;
  created_at: string | null;
  image_url: string | null;
  headline: string | null;
  short_description: string | null;
  rating_avg: number | null;
  reviews_count: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  instagram_url: string | null;
  categories: { name: string } | { name: string }[] | null;
};

/** Pin cards clamp the blurb to two lines — no need to ship whole descriptions. */
function pinBlurb(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

function mapBusinessHomePin(row: HomeMapBusinessRow): HomeMapPin | null {
  const shortDescription = pinBlurb(row.short_description);
  const lat = row.latitude;
  const lng = row.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!(row.address_line ?? "").trim()) return null;
  const cats = row.categories;
  const categoryName = Array.isArray(cats)
    ? (cats[0]?.name ?? null)
    : (cats?.name ?? null);
  const { city, postalCode } = resolvePublicCityPostal({
    addressLine: row.address_line,
    city: row.city,
    region: null,
    postalCode: row.postal_code,
    shortDescription: row.short_description,
    description: row.description,
    businessName: row.name,
  });
  return {
    id: row.id,
    kind: "business",
    name: row.name,
    slug: row.slug,
    href: `/business/${row.slug}`,
    city,
    stateCode: row.state_code?.trim() || null,
    postalCode,
    latitude: lat,
    longitude: lng,
    createdAt: row.created_at ?? null,
    imageUrl: row.image_url ?? null,
    categoryName,
    shortDescription,
    description: shortDescription ? null : pinBlurb(row.description),
    ratingAvg: Number(row.rating_avg ?? 0),
    reviewsCount: Number(row.reviews_count ?? 0),
    googleRating: row.google_rating == null ? null : Number(row.google_rating),
    googleReviewsCount: Number(row.google_reviews_count ?? 0),
    yelpRating: row.yelp_rating == null ? null : Number(row.yelp_rating),
    yelpReviewsCount: Number(row.yelp_reviews_count ?? 0),
    trustpilotRating:
      (row as { trustpilot_rating?: number | null }).trustpilot_rating == null
        ? null
        : Number(
            (row as { trustpilot_rating?: number | null }).trustpilot_rating,
          ),
    trustpilotReviewsCount: Number(
      (row as { trustpilot_reviews_count?: number | null })
        .trustpilot_reviews_count ?? 0,
    ),
    facebookRecommendPct:
      (row as { facebook_recommend_pct?: number | null })
        .facebook_recommend_pct == null
        ? null
        : Number(
            (row as { facebook_recommend_pct?: number | null })
              .facebook_recommend_pct,
          ),
    facebookReviewsCount: Number(
      (row as { facebook_reviews_count?: number | null })
        .facebook_reviews_count ?? 0,
    ),
    instagramFollowersCount:
      row.instagram_followers_count == null
        ? null
        : Number(row.instagram_followers_count),
    presenceFlags: computePresenceFlags(row),
  };
}

function mapProfessionalHomePin(row: HomeMapProfessionalRow): HomeMapPin | null {
  const lat = row.latitude;
  const lng = row.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!(row.private_address_line ?? "").trim()) return null;
  const cats = row.categories;
  const categoryName = Array.isArray(cats)
    ? (cats[0]?.name ?? null)
    : (cats?.name ?? null);
  const { city, postalCode } = resolvePublicCityPostal({
    addressLine: row.private_address_line,
    city: row.city,
    shortDescription: row.short_description || row.headline,
    businessName: row.display_name,
  });
  return {
    id: row.id,
    kind: "professional",
    name: row.display_name,
    slug: row.slug,
    href: `/professional/${row.slug}`,
    city,
    stateCode: row.state_code?.trim() || null,
    postalCode,
    latitude: lat,
    longitude: lng,
    createdAt: row.created_at ?? null,
    imageUrl: row.image_url ?? null,
    categoryName,
    shortDescription: pinBlurb(row.short_description || row.headline),
    description: null,
    ratingAvg: Number(row.rating_avg ?? 0),
    reviewsCount: Number(row.reviews_count ?? 0),
    googleRating: null,
    googleReviewsCount: 0,
    yelpRating: null,
    yelpReviewsCount: 0,
    trustpilotRating: null,
    trustpilotReviewsCount: 0,
    facebookRecommendPct: null,
    facebookReviewsCount: 0,
    instagramFollowersCount: null,
    presenceFlags: computePresenceFlags({
      phone: row.phone,
      email: row.email,
      website: row.website,
      instagram_url: row.instagram_url,
      latitude: lat,
      longitude: lng,
    }),
  };
}

async function fetchBusinessMapRows(
  client: Client,
  limit: number,
  offset: number,
  bounds?: RegionMapBounds,
): Promise<HomeMapBusinessRow[]> {
  let request = client
    .from("businesses")
    .select(HOME_MAP_BUSINESS_SELECT)
    .eq("status", "approved")
    .not("address_line", "is", null)
    .not("latitude", "is", null)
    .not("longitude", "is", null);

  if (bounds) {
    request = request
      .gte("latitude", bounds.south)
      .lte("latitude", bounds.north)
      .gte("longitude", bounds.west)
      .lte("longitude", bounds.east);
  }

  const { data, error } = await request
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as HomeMapBusinessRow[];
}

async function fetchProfessionalMapRows(
  client: Client,
  limit: number,
  offset: number,
  bounds?: RegionMapBounds,
): Promise<HomeMapProfessionalRow[]> {
  const untyped = client as unknown as SupabaseClient;
  let request = untyped
    .from("professionals")
    .select(HOME_MAP_PROFESSIONAL_SELECT)
    .eq("status", "approved")
    .not("private_address_line", "is", null)
    .not("latitude", "is", null)
    .not("longitude", "is", null);

  if (bounds) {
    request = request
      .gte("latitude", bounds.south)
      .lte("latitude", bounds.north)
      .gte("longitude", bounds.west)
      .lte("longitude", bounds.east);
  }

  const { data, error } = await request
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as HomeMapProfessionalRow[];
}

function mapChurchHomePin(row: HomeMapChurchRow): HomeMapPin | null {
  const lat = row.latitude;
  const lng = row.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!(row.address_line ?? "").trim()) return null;
  const { city, postalCode } = resolvePublicCityPostal({
    addressLine: row.address_line,
    city: row.city,
    postalCode: row.postal_code,
    shortDescription: row.description,
    businessName: row.name,
  });
  return {
    id: row.id,
    kind: "church",
    name: row.name,
    slug: row.slug,
    href: `/churches/${row.slug}`,
    city,
    stateCode: row.state_code?.trim() || null,
    postalCode,
    latitude: lat,
    longitude: lng,
    createdAt: row.created_at ?? null,
    imageUrl: row.image_url ?? null,
    categoryName: "Церковь",
    shortDescription: pinBlurb(row.description),
    description: null,
    ratingAvg: 0,
    reviewsCount: 0,
    googleRating: null,
    googleReviewsCount: 0,
    yelpRating: null,
    yelpReviewsCount: 0,
    trustpilotRating: null,
    trustpilotReviewsCount: 0,
    facebookRecommendPct: null,
    facebookReviewsCount: 0,
    instagramFollowersCount: null,
    presenceFlags: computePresenceFlags({
      latitude: lat,
      longitude: lng,
    }),
  };
}

async function fetchChurchMapRows(
  client: Client,
  limit: number,
  offset: number,
  bounds?: RegionMapBounds,
): Promise<HomeMapChurchRow[]> {
  const untyped = client as unknown as SupabaseClient;
  let request = untyped
    .from("churches")
    .select(HOME_MAP_CHURCH_SELECT)
    .eq("status", "approved")
    .not("address_line", "is", null)
    .not("latitude", "is", null)
    .not("longitude", "is", null);

  if (bounds) {
    request = request
      .gte("latitude", bounds.south)
      .lte("latitude", bounds.north)
      .gte("longitude", bounds.west)
      .lte("longitude", bounds.east);
  }

  const { data, error } = await request
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as HomeMapChurchRow[];
}

async function fetchHomeMapPinsSlice(
  client: Client,
  limit: number,
  bounds?: RegionMapBounds,
): Promise<HomeMapPin[]> {
  const [bizRows, proRows, churchRows] = await Promise.all([
    fetchBusinessMapRows(client, limit, 0, bounds),
    fetchProfessionalMapRows(client, limit, 0, bounds),
    fetchChurchMapRows(client, limit, 0, bounds),
  ]);

  const pins: HomeMapPin[] = [];
  for (const row of bizRows) {
    const pin = mapBusinessHomePin(row);
    if (pin) pins.push(pin);
  }
  for (const row of proRows) {
    const pin = mapProfessionalHomePin(row);
    if (pin) pins.push(pin);
  }
  for (const row of churchRows) {
    const pin = mapChurchHomePin(row);
    if (pin) pins.push(pin);
  }
  return pins;
}

/** PostgREST caps a single response; page through it to cover the whole country. */
async function fetchAllRows<Row>(
  fetchPage: (limit: number, offset: number) => Promise<Row[]>,
  pageSize: number,
  maxRows: number,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const page = await fetchPage(Math.min(pageSize, maxRows - offset), offset);
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

export type GetHomeMapPinsOptions = {
  /** Max pins per entity type when hubs are not set (national slice). */
  limit?: number;
  /**
   * When set, load pins inside each hub’s mapBounds (parallel) so switching
   * regions on the home map is not capped by a national newest-N slice.
   */
  hubs?: readonly RegionHub[];
  /** Max pins per entity type per hub when `hubs` is set. */
  limitPerHub?: number;
};

/**
 * Approved catalog rows with address + coordinates for the home activity map.
 * Prefer passing launch hubs so LA/OC/etc. each get their own bounding-box slice
 * instead of fighting for spots in one national newest-800 list.
 *
 * When `hubs` is set, result is cached 300s (home SSR path).
 */
export async function getHomeMapPins(
  client: Client,
  limitOrOptions: number | GetHomeMapPinsOptions = 800,
): Promise<HomeMapPin[]> {
  const options: GetHomeMapPinsOptions =
    typeof limitOrOptions === "number"
      ? { limit: limitOrOptions }
      : limitOrOptions;
  const hubs = options.hubs;

  if (hubs && hubs.length > 0) {
    const limitPerHub = options.limitPerHub ?? 500;

    // Cache each hub's slice separately (not one combined blob) — a 5-hub
    // combined payload can exceed Next's 2MB per-item data-cache limit, which
    // silently fails to cache and forces every request to redo the full
    // 5-hub x 3-table Supabase fan-out + re-serialize ~3MB of JSON. That
    // repeated work was spiking function memory to the point of OOM kills
    // on "/", which is why the map sometimes loads slow with no pins.
    const batches = await Promise.all(
      hubs.map((hub) =>
        // Caller should pass a catalog-capable client (service role on server pages).
        unstable_cache(
          () => fetchHomeMapPinsSlice(client, limitPerHub, hub.mapBounds),
          ["home-map-pins-v2", hub.id, String(limitPerHub)],
          {
            revalidate: CATALOG_CACHE_TTL.homeMapPins,
            tags: [CATALOG_CACHE_TAGS.homeMapPins],
          },
        )(),
      ),
    );
    const byKey = new Map<string, HomeMapPin>();
    for (const batch of batches) {
      for (const pin of batch) {
        byKey.set(`${pin.kind}:${pin.id}`, pin);
      }
    }
    return [...byKey.values()];
  }

  return fetchHomeMapPinsSlice(client, options.limit ?? 800);
}

/** Uncached per-hub map pins — admin health latency probe. */
export async function getHomeMapPinsUncached(
  client: Client,
  options: GetHomeMapPinsOptions,
): Promise<HomeMapPin[]> {
  const hubs = options.hubs;
  if (!hubs || hubs.length === 0) {
    return fetchHomeMapPinsSlice(client, options.limit ?? 800);
  }
  const limitPerHub = options.limitPerHub ?? 500;
  const batches = await Promise.all(
    hubs.map((hub) =>
      fetchHomeMapPinsSlice(client, limitPerHub, hub.mapBounds),
    ),
  );
  const byKey = new Map<string, HomeMapPin>();
  for (const batch of batches) {
    for (const pin of batch) {
      byKey.set(`${pin.kind}:${pin.id}`, pin);
    }
  }
  return [...byKey.values()];
}

export type GetAllHomeMapPinsOptions = {
  pageSize?: number;
  maxPerKind?: number;
};

/**
 * Every approved business/professional with coordinates, nationwide.
 * Used by the USA overview map, where hub bounding boxes would hide
 * everything outside the California launch markets.
 */
export async function getAllHomeMapPins(
  client: Client,
  options: GetAllHomeMapPinsOptions = {},
): Promise<HomeMapPin[]> {
  const pageSize = options.pageSize ?? 1000;
  const maxPerKind = options.maxPerKind ?? 8000;

  const [bizRows, proRows, churchRows] = await Promise.all([
    fetchAllRows(
      (limit, offset) => fetchBusinessMapRows(client, limit, offset),
      pageSize,
      maxPerKind,
    ),
    fetchAllRows(
      (limit, offset) => fetchProfessionalMapRows(client, limit, offset),
      pageSize,
      maxPerKind,
    ),
    fetchAllRows(
      (limit, offset) => fetchChurchMapRows(client, limit, offset),
      pageSize,
      maxPerKind,
    ),
  ]);

  const pins: HomeMapPin[] = [];
  for (const row of bizRows) {
    const pin = mapBusinessHomePin(row);
    if (pin) pins.push(pin);
  }
  for (const row of proRows) {
    const pin = mapProfessionalHomePin(row);
    if (pin) pins.push(pin);
  }
  for (const row of churchRows) {
    const pin = mapChurchHomePin(row);
    if (pin) pins.push(pin);
  }
  return pins;
}

type StateCountSourceRow = {
  state_code: string | null;
  postal_code: string | null;
  city: string | null;
};

async function fetchStateCountSourceRows(
  client: Client,
  table: "businesses" | "professionals" | "churches",
  addressColumn: string,
  limit: number,
  offset: number,
): Promise<StateCountSourceRow[]> {
  const untyped = client as unknown as SupabaseClient;
  const { data, error } = await untyped
    .from(table)
    .select("state_code, postal_code, city")
    .eq("status", "approved")
    .not(addressColumn, "is", null)
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as StateCountSourceRow[];
}

function resolveMapStateCode(row: {
  state_code?: string | null;
  postal_code?: string | null;
  city?: string | null;
}): string | null {
  return (
    reconcileStateCode({
      stateCode: row.state_code,
      postalCode: row.postal_code,
      city: row.city,
    }) ?? normalizeUsStateCode(row.state_code)
  );
}

export type HomeMapStateCount = { stateCode: string; count: number };

/**
 * Nationwide pin counts per state — lightweight fields only (no listing
 * card payloads). Same gate as map pins: approved + address + lat/lng.
 * Resolves missing `state_code` via ZIP/city so bubbles match what
 * appears after zoom.
 */
export async function getHomeMapStateCounts(
  client: Client,
): Promise<HomeMapStateCount[]> {
  return unstable_cache(
    async () => {
      const pageSize = 1000;
      const maxRows = 20000;
      const [bizRows, proRows, churchRows] = await Promise.all([
        fetchAllRows(
          (limit, offset) =>
            fetchStateCountSourceRows(
              client,
              "businesses",
              "address_line",
              limit,
              offset,
            ),
          pageSize,
          maxRows,
        ),
        fetchAllRows(
          (limit, offset) =>
            fetchStateCountSourceRows(
              client,
              "professionals",
              "private_address_line",
              limit,
              offset,
            ),
          pageSize,
          maxRows,
        ),
        fetchAllRows(
          (limit, offset) =>
            fetchStateCountSourceRows(
              client,
              "churches",
              "address_line",
              limit,
              offset,
            ),
          pageSize,
          maxRows,
        ),
      ]);

      const counts = new Map<string, number>();
      for (const row of [...bizRows, ...proRows, ...churchRows]) {
        const code = resolveMapStateCode(row);
        if (!code) continue;
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
      return [...counts.entries()].map(([stateCode, count]) => ({
        stateCode,
        count,
      }));
    },
    ["home-map-state-counts-v2"],
    {
      revalidate: CATALOG_CACHE_TTL.homeMapStateCounts,
      tags: [CATALOG_CACHE_TAGS.homeMapStateCounts],
    },
  )();
}

/** @deprecated prefer getHomeMapPins */
export async function getHomeMapBusinesses(
  client: Client,
  limit = 500,
): Promise<Business[]> {
  const { data, error } = await client
    .from("businesses")
    .select(BUSINESS_LIST_SELECT)
    .eq("status", "approved")
    .not("address_line", "is", null)
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as unknown as BusinessWithCategory[]).map(mapBusinessList);
}

/** @deprecated use getHomeMapPins */
export async function getHomeActivityBusinesses(
  client: Client,
  limit = 500,
): Promise<{ newest: Business[]; popular: Business[] }> {
  const businesses = await getHomeMapBusinesses(client, limit);
  return { newest: businesses, popular: businesses };
}

export async function getBusinessBySlug(
  client: Client,
  slug: string,
): Promise<Business | null> {
  const normalized = normalizeRouteSlug(slug);
  const { data, error } = await client
    .from("businesses")
    .select(BUSINESS_DETAIL_SELECT)
    .eq("slug", normalized)
    .eq("status", "approved")
    .maybeSingle();

  if (error) throw error;
  return data ? mapBusinessDetail(data as unknown as BusinessWithCategory) : null;
}

/**
 * Cached read for the public `/business/[slug]` route (approved-only, same
 * shape as getBusinessBySlug). Own service-role client + slug-only key so
 * generateMetadata and the page body share one Data Cache entry instead of
 * hitting Postgres twice per request. Owner/admin mutations must call
 * revalidateTag(businessDetailTag(slug)) so edits show up immediately —
 * the 45s TTL is just the fallback if a call site is ever missed.
 */
export function getCachedBusinessBySlug(slug: string): Promise<Business | null> {
  const normalized = normalizeRouteSlug(slug);
  return unstable_cache(
    async () => {
      const catalog = createServiceRoleClient();
      return getBusinessBySlug(catalog, normalized);
    },
    ["business-detail-v1", normalized],
    {
      revalidate: ENTITY_DETAIL_TTL,
      tags: [businessDetailTag(normalized)],
    },
  )();
}

/** Owner/admin read — any status (RLS-gated). */
export async function getBusinessBySlugForOwner(
  client: Client,
  slug: string,
): Promise<Business | null> {
  const normalized = normalizeRouteSlug(slug);
  const { data, error } = await client
    .from("businesses")
    .select(BUSINESS_DETAIL_SELECT)
    .eq("slug", normalized)
    .maybeSingle();

  if (error) throw error;
  return data ? mapBusinessDetail(data as unknown as BusinessWithCategory) : null;
}

export async function getBusinessById(
  client: Client,
  id: string,
): Promise<Business | null> {
  const { data, error } = await client
    .from("businesses")
    .select(BUSINESS_DETAIL_SELECT)
    .eq("id", id)
    .eq("status", "approved")
    .maybeSingle();

  if (error) throw error;
  return data ? mapBusinessDetail(data as unknown as BusinessWithCategory) : null;
}

export async function searchBusinesses(
  client: Client,
  params: BusinessSearchParams = {},
): Promise<Business[]> {
  const query = params.query?.trim() ?? "";
  const city = params.city?.trim() ?? "";

  let categoryId = params.categoryId ?? null;
  if (!categoryId && params.categorySlug) {
    const category = await getCategoryBySlug(client, params.categorySlug);
    if (!category) return [];
    categoryId = category.id;
  }

  const hubs = params.hubId
    ? getRegionHubsByIds(parseHubIds(params.hubId))
    : [];
  const nationalHub =
    !params.hubId || hubs.some((h) => h.id === "usa-overview");

  const buildPageQuery = () => {
    let pageQuery = client
      .from("businesses")
      .select(BUSINESS_LIST_SELECT)
      .eq("status", "approved");

    if (categoryId) {
      pageQuery = pageQuery.eq("category_id", categoryId);
    }
    if (city) {
      pageQuery = pageQuery.ilike("city", escapeIlike(city));
    }
    if (query) {
      const tokens = searchTokens(query);
      const expanded = [
        ...new Set(
          tokens.flatMap((t) => {
            const base = expandSearchToken(t);
            if (/^\d{10}$/.test(t)) {
              return [
                ...base,
                t.slice(0, 3),
                t.slice(3, 6),
                t.slice(6),
                `${t.slice(0, 3)}-${t.slice(3, 6)}`,
                `${t.slice(3, 6)}-${t.slice(6)}`,
              ];
            }
            if (/^\d{7}$/.test(t)) {
              return [
                ...base,
                t.slice(0, 3),
                t.slice(3),
                `${t.slice(0, 3)}-${t.slice(3)}`,
              ];
            }
            return base;
          }),
        ),
      ];
      const fields = [
        "name",
        "slug",
        "short_description",
        "description",
        "city",
        "address_line",
        "phone",
      ] as const;
      const clauses = expanded.flatMap((token) => {
        const pattern = `%${escapeIlike(token)}%`;
        return fields.map((field) => `${field}.ilike.${pattern}`);
      });
      if (clauses.length > 0) {
        pageQuery = pageQuery.or(clauses.join(","));
      }
    }
    return pageQuery
      .order("rating_avg", { ascending: false })
      .order("name", { ascending: true });
  };

  // PostgREST often caps a single response at ~1000 rows. Hub filter is in
  // memory — page through the catalog so OC/LA list matches the home counter.
  const pageSize = 1000;
  const maxRows = nationalHub ? (query ? 400 : 800) : 20_000;
  const rawRows: BusinessWithCategory[] = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const end = Math.min(offset + pageSize, maxRows) - 1;
    const { data, error } = await buildPageQuery().range(offset, end);
    if (error) throw error;
    const batch = (data ?? []) as unknown as BusinessWithCategory[];
    rawRows.push(...batch);
    if (batch.length < pageSize) break;
    if (nationalHub) break;
  }

  let results = rawRows.map(mapBusinessList);

  // Match category name against free-text query (not covered by column `.or`).
  // Synonyms: "маникюр" also matches "manicure" / "nails".
  // Phone digits: "(949) 555-0121" must match query "9495550121".
  if (query) {
    const words = searchTokens(query).map((w) => w.toLowerCase());
    if (words.length > 0) {
      results = results.filter((business) => {
        const phoneDigits = (business.phone ?? "").replace(/\D/g, "");
        const haystack = [
          business.name,
          business.slug,
          business.shortDescription,
          business.description,
          business.city,
          business.addressLine,
          business.categoryName,
          business.phone,
          phoneDigits,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return words.every((word) => {
          const w = word.toLowerCase();
          if (/^\d{7,10}$/.test(w) && phoneDigits.includes(w)) return true;
          return haystackMatchesToken(haystack, word);
        });
      });
    }
  }

  if (params.hubId) {
    if (!nationalHub) {
      results = results.filter((business) =>
        hubs.some((hub) =>
          locationFieldsMatchHub(
            {
              city: business.city,
              region: business.region,
              text: business.shortDescription,
              latitude: business.latitude,
              longitude: business.longitude,
              countyGeoid:
                (business as { countyGeoid?: string | null }).countyGeoid ??
                (business as { county_geoid?: string | null }).county_geoid ??
                null,
            },
            hub,
          ),
        ),
      );
    }
  }

  const nearLat = params.nearLat;
  const nearLng = params.nearLng;
  if (
    typeof nearLat === "number" &&
    Number.isFinite(nearLat) &&
    typeof nearLng === "number" &&
    Number.isFinite(nearLng)
  ) {
    results = [...results].sort((a, b) => {
      const da = hasCoordinates(a)
        ? distanceKm(nearLat, nearLng, a.latitude, a.longitude)
        : Number.POSITIVE_INFINITY;
      const db = hasCoordinates(b)
        ? distanceKm(nearLat, nearLng, b.latitude, b.longitude)
        : Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      return compareBusinessesByCompleteness(a, b);
    });
  } else {
    results = [...results].sort(compareBusinessesByCompleteness);
  }

  return results;
}

/** Approved businesses that have map coordinates. */
export async function getBusinessesForMap(
  client: Client,
  params: BusinessSearchParams = {},
): Promise<Business[]> {
  const businesses = await searchBusinesses(client, params);
  return businesses.filter(hasCoordinates);
}

/**
 * All approved businesses with a real street address + coordinates
 * for the full-platform map page. County-only pins (no address) are excluded.
 */
export async function getAllMappableBusinesses(
  client: Client,
  limit = 500,
): Promise<Business[]> {
  const { data, error } = await client
    .from("businesses")
    .select(BUSINESS_LIST_SELECT)
    .eq("status", "approved")
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .not("address_line", "is", null)
    .order("name", { ascending: true })
    .limit(limit);

  if (error) throw error;

  return ((data ?? []) as unknown as BusinessWithCategory[])
    .filter((row) => {
      const address = row.address_line?.trim() ?? "";
      if (!address) return false;
      if (row.location_precision === "county") return false;
      const city = (row.city ?? "").trim().toLowerCase();
      if (
        (city === "orange county" ||
          city === "los angeles" ||
          city === "southern california") &&
        !/\d/.test(address)
      ) {
        return false;
      }
      return true;
    })
    .map(mapBusinessList)
    .filter(hasCoordinates);
}

export async function getCategoryBySlug(
  client: Client,
  slug: string,
): Promise<Category | null> {
  const { data, error } = await client
    .from("categories")
    .select("*")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  return data ? mapCategory(data) : null;
}

export async function countBusinessesByCategory(
  client: Client,
): Promise<Record<string, number>> {
  const { data, error } = await client
    .from("businesses")
    .select("category_id")
    .eq("status", "approved");

  if (error) throw error;

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    if (!row.category_id) continue;
    counts[row.category_id] = (counts[row.category_id] ?? 0) + 1;
  }
  return counts;
}

export function normalizeProfileRow(row: ProfileRow | null): ProfileRow | null {
  if (!row) return null;
  return {
    ...row,
    profile_visibility: row.profile_visibility ?? "public",
    default_author_visibility: row.default_author_visibility ?? "public",
    public_activity_enabled: row.public_activity_enabled ?? true,
    show_reviews_in_profile: row.show_reviews_in_profile ?? true,
    show_listings_in_profile: row.show_listings_in_profile ?? true,
  };
}

export async function getProfileById(
  client: Client,
  userId: string,
): Promise<ProfileRow | null> {
  const { data, error } = await client
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return normalizeProfileRow(data);
}

export async function updateProfileDisplayName(
  client: Client,
  userId: string,
  displayName: string,
): Promise<ProfileRow> {
  const { data, error } = await client
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", userId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}
