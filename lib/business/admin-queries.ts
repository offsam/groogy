import type { SupabaseClient } from "@supabase/supabase-js";
import type { Business } from "@/types/business";
import type { BusinessWithCategory } from "@/types/database";
import { mapBusinessDetail } from "@/lib/supabase/mappers";

export type AdminBusinessRow = {
  id: string;
  slug: string;
  name: string;
  status: "draft" | "pending" | "approved" | "rejected" | "archived" | "deferred";
  phone: string | null;
  website: string | null;
  city: string | null;
  address_line: string | null;
  latitude: number | null;
  longitude: number | null;
  image_url: string | null;
  short_description: string | null;
  description: string | null;
  email: string | null;
  instagram_url: string | null;
  yelp_url: string | null;
  yelp_rating: number | null;
  yelp_reviews_count: number | null;
  instagram_followers_count: number | null;
  google_maps_url: string | null;
  google_rating: number | null;
  google_reviews_count: number | null;
  rating_avg: number | null;
  reviews_count: number | null;
  ai_verified_reviews_count: number | null;
  transaction_verified_reviews_count: number | null;
  region: string | null;
  location_precision: "street" | "county" | null;
  opening_hours: unknown;
  category_id: string | null;
  created_at: string;
  offers_count: number;
  categories: {
    id: string;
    slug: string;
    name: string;
    icon: string | null;
  } | null;
};

export type DuplicateReason = "phone" | "name";

export type DuplicatePair = {
  id: string;
  reason: DuplicateReason;
  reasonLabel: string;
  a: AdminBusinessRow;
  b: AdminBusinessRow;
};

const ADMIN_BUSINESS_SELECT = `
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
  yelp_url,
  yelp_rating,
  yelp_reviews_count,
  instagram_followers_count,
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
  opening_hours,
  created_at,
  categories (
    id,
    slug,
    name,
    icon
  )
`;

/** Map admin list row → public Business shape for card preview. */
export function adminBusinessToPreview(row: AdminBusinessRow): Business {
  return mapBusinessDetail({
    id: row.id,
    slug: row.slug,
    category_id: row.category_id,
    name: row.name,
    short_description: row.short_description,
    description: row.description,
    status: row.status,
    rating_avg: row.rating_avg ?? 0,
    reviews_count: row.reviews_count ?? 0,
    ai_verified_reviews_count: row.ai_verified_reviews_count ?? 0,
    transaction_verified_reviews_count:
      row.transaction_verified_reviews_count ?? 0,
    phone: row.phone,
    email: row.email,
    website: row.website,
    instagram_url: row.instagram_url,
    yelp_url: row.yelp_url,
    yelp_rating: row.yelp_rating ?? null,
    yelp_reviews_count: row.yelp_reviews_count ?? 0,
    instagram_followers_count: row.instagram_followers_count ?? null,
    google_maps_url: row.google_maps_url,
    google_rating: row.google_rating,
    google_reviews_count: row.google_reviews_count ?? 0,
    image_url: row.image_url,
    address_line: row.address_line,
    city: row.city,
    region: row.region,
    latitude: row.latitude,
    longitude: row.longitude,
    location_precision: row.location_precision,
    opening_hours: row.opening_hours,
    created_at: row.created_at,
    updated_at: row.created_at,
    categories: row.categories,
  } as BusinessWithCategory);
}

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length >= 10 ? digits : null;
}

export function normalizeBusinessName(name: string | null | undefined): string {
  if (!name) return "";
  let n = name.toLowerCase();
  n = n.replace(/[^a-z0-9а-яё]+/gi, " ");
  for (const w of [
    "inc",
    "llc",
    "law",
    "pc",
    "the",
    "realtor",
    "fitness trainer",
    "hair salon",
    "cleaning services",
    "homemade food delivery",
    "immigration attorney",
    "real estate agent",
  ]) {
    n = n.replace(new RegExp(`\\b${w}\\b`, "g"), " ");
  }
  return n.replace(/\s+/g, " ").trim();
}

function preferCanonical(
  a: AdminBusinessRow,
  b: AdminBusinessRow,
): [AdminBusinessRow, AdminBusinessRow] {
  const score = (row: AdminBusinessRow) => {
    let s = 0;
    if (row.slug.startsWith("consolidated-")) s += 30;
    else if (row.slug.startsWith("enriched-")) s += 20;
    else if (row.slug.startsWith("fb-post-")) s += 10;
    if (row.status === "approved") s += 15;
    else if (row.status === "pending") s += 5;
    s += Math.min(row.offers_count, 20);
    if (row.phone) s += 2;
    if (row.address_line) s += 2;
    if (row.latitude != null) s += 2;
    return s;
  };
  return score(a) >= score(b) ? [a, b] : [b, a];
}

export function findDuplicatePairs(rows: AdminBusinessRow[]): DuplicatePair[] {
  const byPhone = new Map<string, AdminBusinessRow[]>();
  const byName = new Map<string, AdminBusinessRow[]>();

  for (const row of rows) {
    if (row.status === "archived") continue;
    const phone = normalizePhone(row.phone);
    if (phone) {
      const list = byPhone.get(phone) ?? [];
      list.push(row);
      byPhone.set(phone, list);
    }
    const name = normalizeBusinessName(row.name);
    if (name.length >= 4) {
      const list = byName.get(name) ?? [];
      list.push(row);
      byName.set(name, list);
    }
  }

  const seen = new Set<string>();
  const pairs: DuplicatePair[] = [];

  function addPair(
    reason: DuplicateReason,
    items: AdminBusinessRow[],
    label: string,
  ) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const [keep, drop] = preferCanonical(items[i], items[j]);
        const key = [keep.id, drop.id].sort().join(":");
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({
          id: key,
          reason,
          reasonLabel: label,
          a: keep,
          b: drop,
        });
      }
    }
  }

  for (const [phone, items] of byPhone) {
    if (items.length < 2) continue;
    addPair("phone", items, `Одинаковый телефон ···${phone.slice(-4)}`);
  }
  for (const [, items] of byName) {
    if (items.length < 2) continue;
    addPair("name", items, "Похожее название");
  }

  return pairs.sort((x, y) => {
    if (x.reason !== y.reason) return x.reason === "phone" ? -1 : 1;
    return x.a.name.localeCompare(y.a.name, "ru");
  });
}

export async function getAdminBusinesses(
  supabase: SupabaseClient,
): Promise<AdminBusinessRow[]> {
  type RawRow = Omit<AdminBusinessRow, "offers_count" | "categories"> & {
    categories:
      | AdminBusinessRow["categories"]
      | NonNullable<AdminBusinessRow["categories"]>[]
      | null;
  };

  const pageSize = 1000;
  const maxRows = 20_000;
  const rawRows: RawRow[] = [];

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const end = Math.min(offset + pageSize, maxRows) - 1;
    const { data, error } = await supabase
      .from("businesses")
      .select(ADMIN_BUSINESS_SELECT)
      .order("name", { ascending: true })
      .range(offset, end);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as unknown as RawRow[];
    rawRows.push(...batch);
    if (batch.length < pageSize) break;
  }

  if (rawRows.length === 0) return [];

  const rows: Omit<AdminBusinessRow, "offers_count">[] = rawRows.map((row) => {
    const cat = Array.isArray(row.categories)
      ? (row.categories[0] ?? null)
      : row.categories;
    return { ...row, categories: cat };
  });

  const ids = rows.map((r) => r.id);
  const counts = new Map<string, number>();
  // PostgREST `.in()` blows up on huge id lists — chunk.
  const chunkSize = 200;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data: offerRows, error: offerError } = await supabase
      .from("business_offers")
      .select("business_id")
      .in("business_id", chunk);
    if (offerError) throw new Error(offerError.message);
    for (const row of offerRows ?? []) {
      const id = row.business_id as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  return rows.map((row) => ({
    ...row,
    offers_count: counts.get(row.id) ?? 0,
  }));
}

/** Exact DB counts for admin business moderation tabs. */
export async function getAdminBusinessStatusCounts(
  supabase: SupabaseClient,
): Promise<{
  pending: number;
  draft: number;
  deferred: number;
  rejected: number;
  approved: number;
  archived: number;
  review: number;
}> {
  const statuses = [
    "pending",
    "draft",
    "deferred",
    "rejected",
    "approved",
    "archived",
  ] as const;
  const entries = await Promise.all(
    statuses.map(async (status) => {
      const { count, error } = await supabase
        .from("businesses")
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      if (error) throw new Error(error.message);
      return [status, count ?? 0] as const;
    }),
  );
  const map = Object.fromEntries(entries) as Record<
    (typeof statuses)[number],
    number
  >;
  return {
    pending: map.pending,
    draft: map.draft,
    deferred: map.deferred,
    rejected: map.rejected,
    approved: map.approved,
    archived: map.archived,
    review: map.pending + map.draft,
  };
}
