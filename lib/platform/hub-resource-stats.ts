import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  getActiveCategories,
  searchBusinesses,
} from "@/lib/supabase/queries";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  searchMarketplaceListings,
  searchLechuListings,
  searchTransferListings,
} from "@/lib/listings/queries";
import { listApprovedProfessionals } from "@/lib/professional/queries";
import { listPublishedJobs } from "@/lib/jobs/queries";
import {
  getRegionHubsByIds,
  locationTextMatchesHub,
  parseHubIds,
} from "@/lib/regions/hubs";

/** Untyped until generated Database types include newer tables. */
function db(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

type EntityStamp = { created: string | null; updated: string | null };

type HubScopedRow = {
  city: string | null;
  county_geoid?: string | null;
  created_at: string | null;
  updated_at: string | null;
  published_at?: string | null;
};

/** Empty city = nationwide / unset → visible in every hub (same as jobs/pros). */
function rowMatchesHub(
  row: { city?: string | null; county_geoid?: string | null },
  hubId: string,
): boolean {
  const hubs = getRegionHubsByIds(parseHubIds(hubId));
  if (row.county_geoid) {
    const allowed = hubs.flatMap((h) => [...h.countyGeoids]);
    if (allowed.length > 0) return allowed.includes(row.county_geoid);
  }
  const text = row.city?.trim();
  if (!text) return true;
  return hubs.some((hub) => locationTextMatchesHub(text, hub));
}

async function loadHubScopedPublished(
  client: unknown,
  table: string,
  hubId: string | null,
  opts?: { preferPublishedAt?: boolean },
): Promise<EntityStamp[]> {
  try {
    const { data, error } = await db(client)
      .from(table)
      .select("city, county_geoid, created_at, updated_at, published_at")
      .eq("status", "published")
      .limit(5000);
    if (error || !data) return [];
    return (data as unknown as HubScopedRow[])
      .filter((row) => !hubId || rowMatchesHub(row, hubId))
      .map((row) => {
        const published = row.published_at ?? null;
        const created = row.created_at ?? null;
        return {
          created: opts?.preferPublishedAt ? published || created : created,
          updated: row.updated_at ?? null,
        };
      });
  } catch {
    return [];
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

export async function getHubResourceStats(
  hubId: string | null | undefined,
  options?: { since?: string | null },
): Promise<HubResourceStats> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return emptyHubResourceStats();
  }

  // null / "all" = same formula as a hub, but across the whole catalog.
  const rawHub = hubId?.trim() || "";
  const scopedHub = rawHub && rawHub !== "all" ? rawHub : null;

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

  const hubOpts = scopedHub ? { hubId: scopedHub } : {};

  const [
    businesses,
    categories,
    marketplace,
    professionals,
    jobs,
    realEstateStamps,
    eventStamps,
    vehicleStamps,
    lechu,
    transfers,
  ] = await Promise.all([
    searchBusinesses(catalog, hubOpts).catch(() => []),
    getActiveCategories(client).catch(() => []),
    searchMarketplaceListings(client, {
      ...hubOpts,
      page: 1,
      pageSize: scopedHub ? 200 : 500,
    }).catch(() => ({ listings: [], total: 0, page: 1, pageSize: 200 })),
    listApprovedProfessionals(catalog, {
      ...hubOpts,
      limit: scopedHub ? 2000 : 5000,
    }).catch(() => []),
    listPublishedJobs(catalog, {
      ...hubOpts,
      limit: scopedHub ? 500 : 2000,
    }).catch(() => []),
    loadHubScopedPublished(catalog, "real_estate_listings", scopedHub),
    loadHubScopedPublished(catalog, "events", scopedHub),
    loadHubScopedPublished(catalog, "vehicles", scopedHub),
    searchLechuListings(client, {
      ...hubOpts,
      page: 1,
      pageSize: scopedHub ? 100 : 500,
    }).catch(() => ({ listings: [], total: 0, page: 1, pageSize: 100 })),
    searchTransferListings(client, {
      ...hubOpts,
      page: 1,
      pageSize: scopedHub ? 100 : 500,
    }).catch(() => ({ listings: [], total: 0, page: 1, pageSize: 100 })),
  ]);

  const national = scopedHub ? null : await loadNationalCounts(client, catalog);

  const professionalStamps: EntityStamp[] = professionals.map((p) => ({
    created: p.publishedAt ?? p.createdAt ?? null,
    updated: p.publishedAt ?? p.createdAt ?? null,
  }));
  const jobStamps: EntityStamp[] = jobs.map((j) => ({
    created: j.publishedAt ?? j.createdAt ?? null,
    updated: j.publishedAt ?? j.createdAt ?? null,
  }));

  const businessIds = businesses.map((b) => b.id);
  const todayKey = laDateKey(new Date());
  const yKey = yesterdayLaKey(todayKey);

  type Stamp = { created: string | null; updated: string | null };
  const stamps: Stamp[] = [];

  let offerCount = 0;
  let offersToday = 0;
  let offersYesterday = 0;
  let offersSince = 0;

  const bizCreatedById = new Map<string, string | null>();
  if (businessIds.length > 0) {
    const [{ data: offerRows, count }, { data: meta }] = await Promise.all([
      client
        .from("business_offers")
        .select("id, created_at, updated_at", { count: "exact" })
        .in("business_id", businessIds)
        .eq("status", "active")
        .eq("visibility", "public")
        .eq("is_available", true)
        .limit(2000),
      client
        .from("businesses")
        .select("id, created_at, updated_at, category_id")
        .in("id", businessIds)
        .eq("status", "approved"),
    ]);

    offerCount = count ?? offerRows?.length ?? 0;
    for (const row of offerRows ?? []) {
      const created = (row.created_at as string) ?? null;
      const updated = (row.updated_at as string) ?? null;
      stamps.push({ created, updated });
      if (inLaDay(created, todayKey)) offersToday += 1;
      if (inLaDay(created, yKey)) offersYesterday += 1;
      if (createdSince(created, sinceOk)) offersSince += 1;
    }
    for (const row of meta ?? []) {
      const created = (row.created_at as string) ?? null;
      const updated = (row.updated_at as string) ?? null;
      bizCreatedById.set(row.id as string, created);
      stamps.push({ created, updated });
    }
  } else {
    for (const b of businesses) {
      bizCreatedById.set(b.id, b.createdAt ?? null);
      stamps.push({ created: b.createdAt ?? null, updated: b.createdAt ?? null });
    }
  }

  const bizCreatedAt = (id: string, fallback: string | null | undefined) =>
    bizCreatedById.get(id) ?? fallback ?? null;

  const businessesToday = businesses.filter((b) =>
    inLaDay(bizCreatedAt(b.id, b.createdAt), todayKey),
  ).length;
  const businessesYesterday = businesses.filter((b) =>
    inLaDay(bizCreatedAt(b.id, b.createdAt), yKey),
  ).length;
  const businessesSince = businesses.filter((b) =>
    createdSince(bizCreatedAt(b.id, b.createdAt), sinceOk),
  ).length;

  const listingsToday = marketplace.listings.filter((l) =>
    inLaDay(l.createdAt ?? null, todayKey),
  ).length;
  const listingsYesterday = marketplace.listings.filter((l) =>
    inLaDay(l.createdAt ?? null, yKey),
  ).length;
  const listingsSince = marketplace.listings.filter((l) =>
    createdSince(l.createdAt ?? null, sinceOk),
  ).length;

  const lechuToday = lechu.listings.filter((l) =>
    inLaDay(l.createdAt ?? null, todayKey),
  ).length;
  const lechuYesterday = lechu.listings.filter((l) =>
    inLaDay(l.createdAt ?? null, yKey),
  ).length;
  const lechuSince = lechu.listings.filter((l) =>
    createdSince(l.createdAt ?? null, sinceOk),
  ).length;

  const transfersToday = transfers.listings.filter((l) =>
    inLaDay(l.createdAt ?? null, todayKey),
  ).length;
  const transfersYesterday = transfers.listings.filter((l) =>
    inLaDay(l.createdAt ?? null, yKey),
  ).length;
  const transfersSince = transfers.listings.filter((l) =>
    createdSince(l.createdAt ?? null, sinceOk),
  ).length;

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

  const resolvedProfessionals = national?.professionals ?? professionals.length;
  const resolvedJobs = national?.jobs ?? jobs.length;
  const resolvedRealEstate = national?.realEstate ?? realEstateStamps.length;
  const resolvedEvents = national?.events ?? eventStamps.length;
  const resolvedVehicles = national?.vehicles ?? vehicleStamps.length;
  const resolvedMarketplace = national?.marketplace ?? marketplace.total;
  const resolvedLechu = national?.lechu ?? lechu.total;
  const resolvedTransfers = national?.transfers ?? transfers.total;
  const resolvedServices = national?.services ?? 0;
  if (national?.offers != null) offerCount = national.offers;

  // Hero line: same day buckets as section cards
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

  const businessCount = national?.businesses ?? businesses.length;
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

  // Category cards still returned for API consumers / search — not shown on home pins
  const bySlug = new Map<string, { total: number; today: number; since: number }>();
  for (const b of businesses) {
    const slug = b.categorySlug;
    if (!slug) continue;
    const created = bizCreatedById.get(b.id) ?? b.createdAt;
    const cur = bySlug.get(slug) ?? { total: 0, today: 0, since: 0 };
    cur.total += 1;
    if (inLaDay(created, todayKey)) cur.today += 1;
    if (createdSince(created, sinceOk)) cur.since += 1;
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
