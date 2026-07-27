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
  getRegionHubsByIds,
  locationFieldsMatchHub,
  parseHubIds,
} from "@/lib/regions/hubs";
import { expandSearchToken, haystackMatchesToken } from "@/lib/search/synonyms";
import { distanceKm } from "@/lib/geo/distance";
import { compareBusinessesByCompleteness } from "@/lib/business/completeness";

type Client = SupabaseClient<Database>;

/** Full row — owners, profile detail, contacts API. */
const BUSINESS_DETAIL_SELECT = `
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
  instagram_followers_count,
  google_maps_url,
  google_rating,
  google_reviews_count,
  booking_url,
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
  categories (
    id,
    slug,
    name,
    icon
  )
` as const;

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

/** Categories used on /professionals (shared business leaves + pro-only). */
export async function getProfessionalCategories(
  client: Client,
): Promise<Category[]> {
  const { data, error } = await client
    .from("categories")
    .select("*")
    .eq("is_active", true)
    .or("domain.eq.professional,domain.eq.business")
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
  return ((data ?? []) as BusinessWithCategory[]).map(mapBusinessList);
}

/** Newest + popular businesses with coordinates for the home activity map. */
/** Home map pin — business or professional with an address + coordinates. */
export type HomeMapPin = {
  id: string;
  kind: "business" | "professional";
  name: string;
  slug: string;
  href: string;
  city: string | null;
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
  instagramFollowersCount: number | null;
  presenceFlags: BusinessPresenceFlags;
};

/**
 * All approved catalog rows that have both an address field and coordinates.
 * Includes street + city-level pins (no county-only exclusion).
 */
export async function getHomeMapPins(
  client: Client,
  limit = 800,
): Promise<HomeMapPin[]> {
  const untyped = client as unknown as SupabaseClient;
  const [bizRes, proRes] = await Promise.all([
    client
      .from("businesses")
      .select(
        "id, slug, name, city, postal_code, latitude, longitude, address_line, created_at, image_url, short_description, description, rating_avg, reviews_count, google_rating, google_reviews_count, yelp_rating, yelp_reviews_count, instagram_followers_count, phone, email, website, instagram_url, telegram_url, source_url, source_kind, yelp_url, google_maps_url, categories(name)",
      )
      .eq("status", "approved")
      .not("address_line", "is", null)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit),
    untyped
      .from("professionals")
      .select(
        "id, slug, display_name, city, latitude, longitude, private_address_line, created_at, image_url, headline, short_description, rating_avg, reviews_count, phone, email, website, instagram_url, categories(name)",
      )
      .eq("status", "approved")
      .not("private_address_line", "is", null)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  if (bizRes.error) throw bizRes.error;
  if (proRes.error) throw proRes.error;

  const pins: HomeMapPin[] = [];

  for (const row of bizRes.data ?? []) {
    const lat = row.latitude;
    const lng = row.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    if (!(row.address_line ?? "").trim()) continue;
    const cats = row.categories as { name: string } | { name: string }[] | null;
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
    pins.push({
      id: row.id,
      kind: "business",
      name: row.name,
      slug: row.slug,
      href: `/business/${row.slug}`,
      city,
      postalCode,
      latitude: lat,
      longitude: lng,
      createdAt: row.created_at ?? null,
      imageUrl: row.image_url ?? null,
      categoryName,
      shortDescription: row.short_description ?? null,
      description: row.description ?? null,
      ratingAvg: Number(row.rating_avg ?? 0),
      reviewsCount: Number(row.reviews_count ?? 0),
      googleRating:
        row.google_rating == null ? null : Number(row.google_rating),
      googleReviewsCount: Number(row.google_reviews_count ?? 0),
      yelpRating: row.yelp_rating == null ? null : Number(row.yelp_rating),
      yelpReviewsCount: Number(row.yelp_reviews_count ?? 0),
      instagramFollowersCount:
        row.instagram_followers_count == null
          ? null
          : Number(row.instagram_followers_count),
      presenceFlags: computePresenceFlags(row),
    });
  }

  for (const row of (proRes.data ?? []) as Array<{
    id: string;
    slug: string;
    display_name: string;
    city: string | null;
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
  }>) {
    const lat = row.latitude;
    const lng = row.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    if (!(row.private_address_line ?? "").trim()) continue;
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
    pins.push({
      id: row.id,
      kind: "professional",
      name: row.display_name,
      slug: row.slug,
      href: `/professional/${row.slug}`,
      city,
      postalCode,
      latitude: lat,
      longitude: lng,
      createdAt: row.created_at ?? null,
      imageUrl: row.image_url ?? null,
      categoryName,
      shortDescription: row.short_description || row.headline || null,
      description: null,
      ratingAvg: Number(row.rating_avg ?? 0),
      reviewsCount: Number(row.reviews_count ?? 0),
      googleRating: null,
      googleReviewsCount: 0,
      yelpRating: null,
      yelpReviewsCount: 0,
      instagramFollowersCount: null,
      presenceFlags: computePresenceFlags({
        phone: row.phone,
        email: row.email,
        website: row.website,
        instagram_url: row.instagram_url,
        latitude: lat,
        longitude: lng,
      }),
    });
  }

  return pins;
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
  return ((data ?? []) as BusinessWithCategory[]).map(mapBusinessList);
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
  const { data, error } = await client
    .from("businesses")
    .select(BUSINESS_DETAIL_SELECT)
    .eq("slug", slug)
    .eq("status", "approved")
    .maybeSingle();

  if (error) throw error;
  return data ? mapBusinessDetail(data as BusinessWithCategory) : null;
}

/** Owner/admin read — any status (RLS-gated). */
export async function getBusinessBySlugForOwner(
  client: Client,
  slug: string,
): Promise<Business | null> {
  const { data, error } = await client
    .from("businesses")
    .select(BUSINESS_DETAIL_SELECT)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  return data ? mapBusinessDetail(data as BusinessWithCategory) : null;
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
  return data ? mapBusinessDetail(data as BusinessWithCategory) : null;
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

  let request = client
    .from("businesses")
    .select(BUSINESS_LIST_SELECT)
    .eq("status", "approved");

  if (categoryId) {
    request = request.eq("category_id", categoryId);
  }

  if (city) {
    request = request.ilike("city", escapeIlike(city));
  }

  if (query) {
    // Broad DB filter: each token (+ synonyms) may match any text field; AND below.
    const tokens = searchTokens(query);
    const expanded = [...new Set(tokens.flatMap((t) => expandSearchToken(t)))];
    const fields = [
      "name",
      "short_description",
      "description",
      "city",
      "address_line",
    ] as const;
    const clauses = expanded.flatMap((token) => {
      const pattern = `%${escapeIlike(token)}%`;
      return fields.map((field) => `${field}.ilike.${pattern}`);
    });
    if (clauses.length > 0) {
      request = request.or(clauses.join(","));
    }
  }

  const { data, error } = await request
    .order("rating_avg", { ascending: false })
    .order("name", { ascending: true })
    .limit(250);

  if (error) throw error;

  let results = ((data ?? []) as BusinessWithCategory[]).map(mapBusinessList);

  // Match category name against free-text query (not covered by column `.or`).
  // Synonyms: "маникюр" also matches "manicure" / "nails".
  if (query) {
    const words = searchTokens(query).map((w) => w.toLowerCase());
    if (words.length > 0) {
      results = results.filter((business) => {
        const haystack = [
          business.name,
          business.shortDescription,
          business.description,
          business.city,
          business.addressLine,
          business.categoryName,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return words.every((word) => haystackMatchesToken(haystack, word));
      });
    }
  }

  if (params.hubId) {
    const hubs = getRegionHubsByIds(parseHubIds(params.hubId));
    results = results.filter((business) =>
      hubs.some((hub) =>
        locationFieldsMatchHub(
          {
            city: business.city,
            region: business.region,
            text: business.shortDescription,
            latitude: business.latitude,
            longitude: business.longitude,
          },
          hub,
        ),
      ),
    );
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

  return ((data ?? []) as BusinessWithCategory[])
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
