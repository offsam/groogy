import { unstable_cache } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getActiveCategories } from "@/lib/supabase/queries";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  CATALOG_CACHE_TAGS,
  CATALOG_CACHE_TTL,
} from "@/lib/platform/catalog-cache";
import {
  getRegionHubsByIds,
  locationFieldsMatchHub,
  parseHubIds,
} from "@/lib/regions/hubs";

/** Untyped until generated Database types include newer tables. */
function db(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

type EntityStamp = {
  id?: string;
  created: string | null;
  updated: string | null;
  categorySlug?: string | null;
};

type HubScopedRow = {
  id?: string;
  city: string | null;
  region?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  county_geoid?: string | null;
  created_at: string | null;
  updated_at: string | null;
  published_at?: string | null;
  category_id?: string | null;
  categories?: { slug?: string | null } | { slug?: string | null }[] | null;
  category_slug?: string | null;
};

const STAMP_LIMIT = 5000;

function asCoord(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Same hub filter as search / listing pages (USA Location Canon). */
function rowMatchesHub(row: HubScopedRow, hubId: string): boolean {
  const hubs = getRegionHubsByIds(parseHubIds(hubId));
  return hubs.some((hub) =>
    locationFieldsMatchHub(
      {
        city: row.city,
        region: row.region,
        latitude: asCoord(row.latitude),
        longitude: asCoord(row.longitude),
        county_geoid: row.county_geoid,
      },
      hub,
    ),
  );
}

function categorySlugFromRow(row: HubScopedRow): string | null {
  const nested = row.categories;
  if (Array.isArray(nested)) {
    return nested[0]?.slug?.trim() || null;
  }
  if (nested && typeof nested === "object") {
    return nested.slug?.trim() || null;
  }
  return row.category_slug?.trim() || null;
}

/**
 * Lightweight stamp rows for day-buckets / hub filter.
 * Never loads full entity payloads (name, description, contacts, …).
 */
async function loadStampRows(
  client: unknown,
  table: string,
  hubId: string | null,
  opts?: {
    status?: string;
    preferPublishedAt?: boolean;
    withCategory?: boolean;
  },
): Promise<EntityStamp[]> {
  try {
    const status = opts?.status ?? "published";
    // businesses/professionals: full geo for canon match. jobs/events: city + county only.
    const richGeo = table === "businesses" || table === "professionals";
    const geoCols = richGeo
      ? "id, city, region, latitude, longitude, county_geoid, created_at, updated_at"
      : "id, city, county_geoid, created_at, updated_at";
    const baseCols = opts?.preferPublishedAt
      ? `${geoCols}, published_at`
      : geoCols;
    const columns = opts?.withCategory
      ? `${baseCols}, category_id, categories(slug)`
      : baseCols;

    const buildQuery = () => {
      let query = db(client).from(table).select(columns).eq("status", status);
      if (hubId) {
        const hubs = getRegionHubsByIds(parseHubIds(hubId));
        const geoids = hubs.flatMap((h) => [...h.countyGeoids]);
        // Prefer county filter when possible; still over-fetch null county for text/coord fallback.
        if (geoids.length > 0) {
          query = query.or(
            `county_geoid.in.(${geoids.join(",")}),county_geoid.is.null`,
          );
        }
      }
      return query.order("id", { ascending: true });
    };

    // PostgREST often caps one response at ~1000 — page so hub counts match the list.
    const pageSize = 1000;
    const maxRows = STAMP_LIMIT;
    const raw: HubScopedRow[] = [];
    for (let offset = 0; offset < maxRows; offset += pageSize) {
      const { data, error } = await buildQuery().range(
        offset,
        offset + pageSize - 1,
      );
      if (error || !data) break;
      const batch = data as unknown as HubScopedRow[];
      raw.push(...batch);
      if (batch.length < pageSize) break;
    }

    return raw
      .filter((row) => !hubId || rowMatchesHub(row, hubId))
      .map((row) => {
        const published = row.published_at ?? null;
        const created = row.created_at ?? null;
        return {
          id: row.id,
          created: opts?.preferPublishedAt ? published || created : created,
          updated: row.updated_at ?? null,
          categorySlug: opts?.withCategory ? categorySlugFromRow(row) : null,
        };
      });
  } catch {
    return [];
  }
}

/** Professionals public view — stamp columns only. */
async function loadProfessionalStamps(
  client: unknown,
  hubId: string | null,
): Promise<EntityStamp[]> {
  try {
    const buildQuery = () => {
      let query = db(client)
        .from("professionals_public")
        .select(
          "id, city, region, latitude, longitude, county_geoid, created_at, published_at, category_slug",
        );
      if (hubId) {
        const hubs = getRegionHubsByIds(parseHubIds(hubId));
        const geoids = hubs.flatMap((h) => [...h.countyGeoids]);
        if (geoids.length > 0) {
          query = query.or(
            `county_geoid.in.(${geoids.join(",")}),county_geoid.is.null`,
          );
        }
      }
      return query.order("id", { ascending: true });
    };

    const pageSize = 1000;
    const maxRows = STAMP_LIMIT;
    const raw: HubScopedRow[] = [];
    for (let offset = 0; offset < maxRows; offset += pageSize) {
      const { data, error } = await buildQuery().range(
        offset,
        offset + pageSize - 1,
      );
      if (error || !data) break;
      const batch = data as unknown as HubScopedRow[];
      raw.push(...batch);
      if (batch.length < pageSize) break;
    }

    return raw
      .filter((row) => !hubId || rowMatchesHub(row, hubId))
      .map((row) => {
        const published = row.published_at ?? null;
        const created = row.created_at ?? null;
        return {
          id: row.id,
          created: published || created,
          updated: published || created,
          categorySlug: row.category_slug?.trim() || null,
        };
      });
  } catch {
    return [];
  }
}

/**
 * Listing catalog views (marketplace/lechu/transfers): city + published_at only —
 * no county_geoid on the view. Hub filter is city-text (empty city = all hubs).
 */
async function loadListingStamps(
  client: unknown,
  view: string,
  hubId: string | null,
): Promise<{ total: number; stamps: EntityStamp[] }> {
  try {
    const stampLimit = hubId ? 500 : STAMP_LIMIT;
    const [{ count }, { data }] = await Promise.all([
      db(client).from(view).select("id", { count: "exact", head: true }),
      db(client)
        .from(view)
        .select("id, city, published_at, updated_at")
        .limit(stampLimit),
    ]);

    type ListingStampRow = {
      id?: string;
      city?: string | null;
      published_at?: string | null;
      updated_at?: string | null;
    };

    const stamps = ((data ?? []) as ListingStampRow[])
      .filter((row) => !hubId || rowMatchesHub({ city: row.city }, hubId))
      .map((row) => ({
        id: row.id,
        created: row.published_at ?? row.updated_at ?? null,
        updated: row.updated_at ?? null,
      }));

    return {
      total: hubId ? stamps.length : (count ?? stamps.length),
      stamps,
    };
  } catch {
    return { total: 0, stamps: [] };
  }
}

/** Exact row count via PostgREST `head` — never capped by a fetch limit. */
async function exactCount(
  client: unknown,
  table: string,
  filters: Record<string, string | number | boolean> = {},
): Promise<number | null> {
  try {
    let query = db(client).from(table).select("id", { count: "exact", head: true });
    for (const [column, value] of Object.entries(filters)) {
      query = query.eq(column, value);
    }
    const { count, error } = await query;
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

type NationalCounts = {
  businesses: number | null;
  professionals: number | null;
  offers: number | null;
  jobs: number | null;
  events: number | null;
  realEstate: number | null;
  vehicles: number | null;
  marketplace: number | null;
  services: number | null;
  lechu: number | null;
  transfers: number | null;
};

/**
 * Whole-catalog totals for hub=all. Section lists are fetched with limits
 * (and can fail), so the hero number must come from real counts instead of
 * `array.length`. Catalog views are readable by anon, base tables by service role.
 */
async function loadNationalCounts(
  anon: unknown,
  catalog: unknown,
): Promise<NationalCounts> {
  const [
    businesses,
    professionals,
    offers,
    jobs,
    events,
    realEstate,
    vehicles,
    marketplace,
    services,
    lechu,
    transfers,
  ] = await Promise.all([
    exactCount(catalog, "businesses", { status: "approved" }),
    exactCount(catalog, "professionals", { status: "approved" }),
    exactCount(catalog, "business_offers", {
      status: "active",
      visibility: "public",
      is_available: true,
    }),
    exactCount(catalog, "jobs", { status: "published" }),
    exactCount(catalog, "events", { status: "published" }),
    exactCount(catalog, "real_estate_listings", { status: "published" }),
    exactCount(catalog, "vehicles", { status: "published" }),
    exactCount(anon, "marketplace_catalog"),
    exactCount(anon, "services_catalog"),
    exactCount(anon, "lechu_catalog"),
    exactCount(anon, "transfers_catalog"),
  ]);

  return {
    businesses,
    professionals,
    offers,
    jobs,
    events,
    realEstate,
    vehicles,
    marketplace,
    services,
    lechu,
    transfers,
  };
}

function countInDay(stamps: EntityStamp[], dayKey: string): number {
  return stamps.filter((s) => inLaDay(s.created, dayKey)).length;
}

function countSinceMs(stamps: EntityStamp[], sinceMs: number | null): number {
  return stamps.filter((s) => createdSince(s.created, sinceMs)).length;
}

export type HubStatCard = {
  key: string;
  kind: "resource" | "category";
  label: string;
  /** Short label under the number */
  unit: string;
  slug: string | null;
  count: number;
  addedToday: number;
  /** Created after visitor's last home visit (falls back to today). */
  addedSince: number;
};

export type HubResourceStats = {
  cards: HubStatCard[];
  total: number;
  addedYesterday: number;
  addedToday: number;
  updatedToday: number;
  /** Platform-wide profile count (only set for hub=all / null). */
  members: number;
  /** ISO timestamp used for addedSince (client last visit or start of today). */
  since: string | null;
};

export function emptyHubResourceStats(): HubResourceStats {
  return {
    cards: [],
    total: 0,
    addedYesterday: 0,
    addedToday: 0,
    updatedToday: 0,
    members: 0,
    since: null,
  };
}

function laDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function yesterdayLaKey(todayKey: string): string {
  const [y, m, d] = todayKey.split("-").map(Number);
  const utcNoon = Date.UTC(y, m - 1, d, 20);
  return laDateKey(new Date(utcNoon - 36 * 3600 * 1000));
}

function inLaDay(iso: string | null | undefined, dayKey: string): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return laDateKey(new Date(t)) === dayKey;
}

function createdSince(iso: string | null | undefined, sinceMs: number | null): boolean {
  if (sinceMs == null || !iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= sinceMs;
}

function shortUnit(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

async function computeHubResourceStats(
  hubId: string | null | undefined,
  options?: { since?: string | null },
): Promise<HubResourceStats> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return emptyHubResourceStats();
  }

  const rawHub = hubId?.trim() || "";
  // USA overview = whole catalog (same as hub=all), not a county-scoped metro.
  const scopedHub =
    rawHub && rawHub !== "all" && rawHub !== "usa-overview" ? rawHub : null;

  const sinceRaw = options?.since?.trim() || null;
  const sinceMs = sinceRaw ? Date.parse(sinceRaw) : Number.NaN;
  const sinceOk = Number.isFinite(sinceMs) ? sinceMs : null;

  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let catalog = client;
  try {
    catalog = createServiceRoleClient();
  } catch {
    // Local misconfig — keep anon (may return 0 after RLS harden).
  }

  const todayKey = laDateKey(new Date());
  const yKey = yesterdayLaKey(todayKey);

  const [
    businessStamps,
    categories,
    marketplace,
    professionalStamps,
    jobStamps,
    realEstateStamps,
    eventStamps,
    vehicleStamps,
    lechu,
    transfers,
    national,
  ] = await Promise.all([
    loadStampRows(catalog, "businesses", scopedHub, {
      status: "approved",
      withCategory: true,
    }),
    getActiveCategories(client).catch(() => []),
    loadListingStamps(client, "marketplace_catalog", scopedHub),
    loadProfessionalStamps(catalog, scopedHub),
    loadStampRows(catalog, "jobs", scopedHub, {
      status: "published",
      preferPublishedAt: true,
    }),
    loadStampRows(catalog, "real_estate_listings", scopedHub),
    loadStampRows(catalog, "events", scopedHub),
    loadStampRows(catalog, "vehicles", scopedHub),
    loadListingStamps(client, "lechu_catalog", scopedHub),
    loadListingStamps(client, "transfers_catalog", scopedHub),
    scopedHub ? Promise.resolve(null) : loadNationalCounts(client, catalog),
  ]);

  const businessIds = businessStamps
    .map((b) => b.id)
    .filter((id): id is string => Boolean(id));

  type Stamp = { created: string | null; updated: string | null };
  const stamps: Stamp[] = [];

  let offerCount = 0;
  let offersToday = 0;
  let offersYesterday = 0;
  let offersSince = 0;

  if (businessIds.length > 0) {
    // Chunk .in() to avoid URL limits on large hubs.
    const chunkSize = 200;
    const offerChunks: Array<{
      created_at: string | null;
      updated_at: string | null;
    }> = [];
    let offerExact: number | null = null;

    for (let i = 0; i < businessIds.length; i += chunkSize) {
      const chunk = businessIds.slice(i, i + chunkSize);
      const { data: offerRows, count } = await client
        .from("business_offers")
        .select("id, created_at, updated_at", { count: "exact" })
        .in("business_id", chunk)
        .eq("status", "active")
        .eq("visibility", "public")
        .eq("is_available", true)
        .limit(2000);
      offerExact = (offerExact ?? 0) + (count ?? offerRows?.length ?? 0);
      for (const row of offerRows ?? []) {
        offerChunks.push({
          created_at: (row.created_at as string) ?? null,
          updated_at: (row.updated_at as string) ?? null,
        });
      }
    }

    offerCount = offerExact ?? offerChunks.length;
    for (const row of offerChunks) {
      const created = row.created_at;
      const updated = row.updated_at;
      stamps.push({ created, updated });
      if (inLaDay(created, todayKey)) offersToday += 1;
      if (inLaDay(created, yKey)) offersYesterday += 1;
      if (createdSince(created, sinceOk)) offersSince += 1;
    }
  }

  for (const b of businessStamps) {
    stamps.push({ created: b.created, updated: b.updated });
  }

  const businessesToday = countInDay(businessStamps, todayKey);
  const businessesYesterday = countInDay(businessStamps, yKey);
  const businessesSince = countSinceMs(businessStamps, sinceOk);

  const listingsToday = countInDay(marketplace.stamps, todayKey);
  const listingsYesterday = countInDay(marketplace.stamps, yKey);
  const listingsSince = countSinceMs(marketplace.stamps, sinceOk);

  const lechuToday = countInDay(lechu.stamps, todayKey);
  const lechuYesterday = countInDay(lechu.stamps, yKey);
  const lechuSince = countSinceMs(lechu.stamps, sinceOk);

  const transfersToday = countInDay(transfers.stamps, todayKey);
  const transfersYesterday = countInDay(transfers.stamps, yKey);
  const transfersSince = countSinceMs(transfers.stamps, sinceOk);

  const professionalsToday = countInDay(professionalStamps, todayKey);
  const professionalsYesterday = countInDay(professionalStamps, yKey);
  const professionalsSince = countSinceMs(professionalStamps, sinceOk);

  const jobsToday = countInDay(jobStamps, todayKey);
  const jobsYesterday = countInDay(jobStamps, yKey);
  const jobsSince = countSinceMs(jobStamps, sinceOk);

  const realEstateToday = countInDay(realEstateStamps, todayKey);
  const realEstateYesterday = countInDay(realEstateStamps, yKey);
  const realEstateSince = countSinceMs(realEstateStamps, sinceOk);

  const eventsToday = countInDay(eventStamps, todayKey);
  const eventsYesterday = countInDay(eventStamps, yKey);
  const eventsSince = countSinceMs(eventStamps, sinceOk);

  const vehiclesToday = countInDay(vehicleStamps, todayKey);
  const vehiclesYesterday = countInDay(vehicleStamps, yKey);
  const vehiclesSince = countSinceMs(vehicleStamps, sinceOk);

  const businessCount = national?.businesses ?? businessStamps.length;
  const resolvedProfessionals =
    national?.professionals ?? professionalStamps.length;
  const resolvedJobs = national?.jobs ?? jobStamps.length;
  const resolvedRealEstate = national?.realEstate ?? realEstateStamps.length;
  const resolvedEvents = national?.events ?? eventStamps.length;
  const resolvedVehicles = national?.vehicles ?? vehicleStamps.length;
  const resolvedMarketplace = national?.marketplace ?? marketplace.total;
  const resolvedLechu = national?.lechu ?? lechu.total;
  const resolvedTransfers = national?.transfers ?? transfers.total;
  const resolvedServices = national?.services ?? 0;
  if (national?.offers != null) offerCount = national.offers;

  const addedToday =
    businessesToday +
    offersToday +
    listingsToday +
    lechuToday +
    transfersToday +
    professionalsToday +
    jobsToday +
    realEstateToday +
    eventsToday +
    vehiclesToday;
  const addedYesterday =
    businessesYesterday +
    offersYesterday +
    listingsYesterday +
    lechuYesterday +
    transfersYesterday +
    professionalsYesterday +
    jobsYesterday +
    realEstateYesterday +
    eventsYesterday +
    vehiclesYesterday;
  const updatedToday = stamps.filter(
    (s) => inLaDay(s.updated, todayKey) && !inLaDay(s.created, todayKey),
  ).length;

  const cards: HubStatCard[] = [];

  cards.push({
    key: "businesses",
    kind: "resource",
    label: "Бизнесы",
    unit: shortUnit(businessCount, "карточка", "карточки", "карточек"),
    slug: null,
    count: businessCount,
    addedToday: businessesToday,
    addedSince: sinceOk != null ? businessesSince : businessesToday,
  });

  cards.push({
    key: "offers",
    kind: "resource",
    label: "Предложения",
    unit: shortUnit(offerCount, "предложение", "предложения", "предложений"),
    slug: null,
    count: offerCount,
    addedToday: offersToday,
    addedSince: sinceOk != null ? offersSince : offersToday,
  });

  cards.push({
    key: "professionals",
    kind: "resource",
    label: "Специалисты",
    unit: shortUnit(
      resolvedProfessionals,
      "специалист",
      "специалиста",
      "специалистов",
    ),
    slug: null,
    count: resolvedProfessionals,
    addedToday: professionalsToday,
    addedSince: sinceOk != null ? professionalsSince : professionalsToday,
  });

  cards.push({
    key: "listings",
    kind: "resource",
    label: "Объявления",
    unit: shortUnit(resolvedMarketplace, "объявление", "объявления", "объявлений"),
    slug: null,
    count: resolvedMarketplace,
    addedToday: listingsToday,
    addedSince: sinceOk != null ? listingsSince : listingsToday,
  });

  cards.push({
    key: "services",
    kind: "resource",
    label: "Услуги",
    unit: shortUnit(resolvedServices, "услуга", "услуги", "услуг"),
    slug: null,
    count: resolvedServices,
    addedToday: 0,
    addedSince: 0,
  });

  cards.push({
    key: "jobs",
    kind: "resource",
    label: "Работа",
    unit: shortUnit(resolvedJobs, "вакансия", "вакансии", "вакансий"),
    slug: null,
    count: resolvedJobs,
    addedToday: jobsToday,
    addedSince: sinceOk != null ? jobsSince : jobsToday,
  });

  cards.push({
    key: "real_estate",
    kind: "resource",
    label: "Недвижимость",
    unit: shortUnit(resolvedRealEstate, "объект", "объекта", "объектов"),
    slug: null,
    count: resolvedRealEstate,
    addedToday: realEstateToday,
    addedSince: sinceOk != null ? realEstateSince : realEstateToday,
  });

  cards.push({
    key: "events",
    kind: "resource",
    label: "События",
    unit: shortUnit(resolvedEvents, "событие", "события", "событий"),
    slug: null,
    count: resolvedEvents,
    addedToday: eventsToday,
    addedSince: sinceOk != null ? eventsSince : eventsToday,
  });

  cards.push({
    key: "vehicles",
    kind: "resource",
    label: "Авто",
    unit: shortUnit(resolvedVehicles, "объявление", "объявления", "объявлений"),
    slug: null,
    count: resolvedVehicles,
    addedToday: vehiclesToday,
    addedSince: sinceOk != null ? vehiclesSince : vehiclesToday,
  });

  cards.push({
    key: "lechu",
    kind: "resource",
    label: "Лечу",
    unit: shortUnit(resolvedLechu, "маршрут", "маршрута", "маршрутов"),
    slug: null,
    count: resolvedLechu,
    addedToday: lechuToday,
    addedSince: sinceOk != null ? lechuSince : lechuToday,
  });

  cards.push({
    key: "transfers",
    kind: "resource",
    label: "Переводы",
    unit: shortUnit(
      resolvedTransfers,
      "предложение",
      "предложения",
      "предложений",
    ),
    slug: null,
    count: resolvedTransfers,
    addedToday: transfersToday,
    addedSince: sinceOk != null ? transfersSince : transfersToday,
  });

  const bySlug = new Map<string, { total: number; today: number; since: number }>();
  for (const b of businessStamps) {
    const slug = b.categorySlug;
    if (!slug) continue;
    const cur = bySlug.get(slug) ?? { total: 0, today: 0, since: 0 };
    cur.total += 1;
    if (inLaDay(b.created, todayKey)) cur.today += 1;
    if (createdSince(b.created, sinceOk)) cur.since += 1;
    bySlug.set(slug, cur);
  }

  for (const cat of categories) {
    const stats = bySlug.get(cat.slug) ?? { total: 0, today: 0, since: 0 };
    cards.push({
      key: `cat-${cat.slug}`,
      kind: "category",
      label: cat.name,
      unit: shortUnit(stats.total, "компания", "компании", "компаний"),
      slug: cat.slug,
      count: stats.total,
      addedToday: stats.today,
      addedSince: sinceOk != null ? stats.since : stats.today,
    });
  }

  const total =
    businessCount +
    offerCount +
    resolvedMarketplace +
    resolvedServices +
    resolvedProfessionals +
    resolvedJobs +
    resolvedRealEstate +
    resolvedEvents +
    resolvedVehicles +
    resolvedLechu +
    resolvedTransfers;

  let members = 0;
  if (!scopedHub) {
    try {
      const { count, error } = await db(catalog)
        .from("profiles")
        .select("id", { count: "exact", head: true });
      if (!error) members = count ?? 0;
    } catch {
      members = 0;
    }
  }

  return {
    cards,
    total,
    addedYesterday,
    addedToday,
    updatedToday,
    members,
    since: sinceOk != null ? new Date(sinceOk).toISOString() : null,
  };
}

/**
 * Hub / platform resource stats for the home hero.
 * Cached 120s — day counters stay near real-time without hammering Supabase.
 */
export async function getHubResourceStats(
  hubId: string | null | undefined,
  options?: { since?: string | null },
): Promise<HubResourceStats> {
  const rawHub = hubId?.trim() || "";
  const hubKey = rawHub && rawHub !== "all" ? rawHub : "all";
  const sinceKey = options?.since?.trim() || "";

  return unstable_cache(
    () => computeHubResourceStats(hubId, options),
    // v6: bust stale OC/LA counts after no-street business → pro migration
    ["hub-resource-stats-v6", hubKey, sinceKey],
    {
      revalidate: CATALOG_CACHE_TTL.hubResourceStats,
      tags: [CATALOG_CACHE_TAGS.hubResourceStats],
    },
  )();
}

/** Bypass Next cache — used by admin System · Health latency probes. */
export async function getHubResourceStatsUncached(
  hubId: string | null | undefined,
  options?: { since?: string | null },
): Promise<HubResourceStats> {
  return computeHubResourceStats(hubId, options);
}
