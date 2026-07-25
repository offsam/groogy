import type { Business, BusinessSearchParams, Category } from "@/types/business";
import type { BusinessWithCategory, Database, ProfileRow } from "@/types/database";
import { hasCoordinates } from "@/types/business";
import { mapBusiness, mapCategory } from "@/lib/supabase/mappers";
import {
  getRegionHubsByIds,
  isLatLngInHubBounds,
  parseHubIds,
} from "@/lib/regions/hubs";
import type { SupabaseClient } from "@supabase/supabase-js";

type Client = SupabaseClient<Database>;

const BUSINESS_SELECT = `
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
  website,
  instagram_url,
  google_maps_url,
  google_rating,
  google_reviews_count,
  image_url,
  address_line,
  city,
  region,
  latitude,
  longitude,
  location_precision,
  created_at,
  updated_at,
  categories (
    id,
    slug,
    name,
    icon
  )
` as const;

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
    .select(BUSINESS_SELECT)
    .eq("status", "approved")
    .order("rating_avg", { ascending: false })
    .order("name", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as BusinessWithCategory[]).map(mapBusiness);
}

/** Newest + popular businesses with coordinates for the home activity map. */
export async function getHomeActivityBusinesses(
  client: Client,
  limit = 40,
): Promise<{ newest: Business[]; popular: Business[] }> {
  const [newestRes, popularRes] = await Promise.all([
    client
      .from("businesses")
      .select(BUSINESS_SELECT)
      .eq("status", "approved")
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .neq("location_precision", "county")
      .order("created_at", { ascending: false })
      .limit(limit),
    client
      .from("businesses")
      .select(BUSINESS_SELECT)
      .eq("status", "approved")
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .neq("location_precision", "county")
      .order("google_rating", { ascending: false })
      .order("rating_avg", { ascending: false })
      .limit(limit),
  ]);

  if (newestRes.error) throw newestRes.error;
  if (popularRes.error) throw popularRes.error;

  return {
    newest: ((newestRes.data ?? []) as BusinessWithCategory[]).map(mapBusiness),
    popular: ((popularRes.data ?? []) as BusinessWithCategory[]).map(mapBusiness),
  };
}

export async function getBusinessBySlug(
  client: Client,
  slug: string,
): Promise<Business | null> {
  const { data, error } = await client
    .from("businesses")
    .select(BUSINESS_SELECT)
    .eq("slug", slug)
    .eq("status", "approved")
    .maybeSingle();

  if (error) throw error;
  return data ? mapBusiness(data as BusinessWithCategory) : null;
}

/** Owner/admin read — any status (RLS-gated). */
export async function getBusinessBySlugForOwner(
  client: Client,
  slug: string,
): Promise<Business | null> {
  const { data, error } = await client
    .from("businesses")
    .select(BUSINESS_SELECT)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  return data ? mapBusiness(data as BusinessWithCategory) : null;
}

export async function getBusinessById(
  client: Client,
  id: string,
): Promise<Business | null> {
  const { data, error } = await client
    .from("businesses")
    .select(BUSINESS_SELECT)
    .eq("id", id)
    .eq("status", "approved")
    .maybeSingle();

  if (error) throw error;
  return data ? mapBusiness(data as BusinessWithCategory) : null;
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
    .select(BUSINESS_SELECT)
    .eq("status", "approved");

  if (categoryId) {
    request = request.eq("category_id", categoryId);
  }

  if (city) {
    request = request.ilike("city", escapeIlike(city));
  }

  if (query) {
    // Broad DB filter: each token may match any text field; AND is applied below.
    const tokens = searchTokens(query);
    const fields = [
      "name",
      "short_description",
      "description",
      "city",
      "address_line",
    ] as const;
    const clauses = tokens.flatMap((token) => {
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

  let results = ((data ?? []) as BusinessWithCategory[]).map(mapBusiness);

  // Match category name against free-text query (not covered by column `.or`).
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
        return words.every((word) => haystack.includes(word));
      });
    }
  }

  if (params.hubId) {
    const hubs = getRegionHubsByIds(parseHubIds(params.hubId));
    results = results.filter((business) => {
      if (hasCoordinates(business)) {
        return hubs.some((hub) =>
          isLatLngInHubBounds(business.latitude, business.longitude, hub),
        );
      }
      const loc = `${business.city ?? ""} ${business.region ?? ""}`.toLowerCase();
      return hubs.some((hub) => {
        const tokens = [hub.shortLabel.toLowerCase(), hub.inLabel.toLowerCase()];
        return tokens.some((token) => token && loc.includes(token));
      });
    });
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
    .select(BUSINESS_SELECT)
    .eq("status", "approved")
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .not("address_line", "is", null)
    .order("name", { ascending: true })
    .limit(limit);

  if (error) throw error;

  return ((data ?? []) as BusinessWithCategory[])
    .map(mapBusiness)
    .filter(hasCoordinates)
    .filter((b) => {
      const address = b.addressLine?.trim() ?? "";
      if (!address) return false;
      if (b.locationPrecision === "county") return false;
      // Reject county-as-city placeholders without a street address pattern
      const city = (b.city ?? "").trim().toLowerCase();
      if (
        (city === "orange county" || city === "los angeles" || city === "southern california") &&
        !/\d/.test(address)
      ) {
        return false;
      }
      return true;
    });
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
