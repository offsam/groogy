import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";
import type { EventSort, EventWhen } from "@/lib/events/regions";
import { normalizeRouteSlug } from "@/lib/routing/normalize-route-slug";

type Client = SupabaseClient<Database>;

/** Table not yet in generated Database types — use untyped from() for admin. */
function recommendationsTable(client: Client) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table pending in Database types
  return (client as SupabaseClient<any>).from("import_comment_recommendations");
}

function eventsTable(client: Client) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table pending in Database types
  return (client as SupabaseClient<any>).from("events");
}

export type PlatformEvent = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  event_at_label: string | null;
  city: string | null;
  state_code?: string | null;
  address_line?: string | null;
  venue_name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  cover_image_url: string | null;
  registration_url: string | null;
  source_url: string | null;
  source_posted_at: string | null;
  source_body: string | null;
  format: string | null;
  price_label?: string | null;
  payment_methods?: string[] | null;
  phone?: string | null;
  telegram_url?: string | null;
  category?: string | null;
  tags?: string[] | null;
  source_language?: string | null;
  title_original?: string | null;
  description_original?: string | null;
  audience_label?: string | null;
  external_source?: string | null;
  external_id?: string | null;
  created_at: string;
};

const EVENT_SELECT =
  "id, title, slug, description, status, starts_at, ends_at, event_at_label, city, state_code, venue_name, latitude, longitude, cover_image_url, registration_url, source_url, source_posted_at, source_body, format, payment_methods, category, tags, source_language, title_original, description_original, audience_label, external_source, external_id, created_at" as const;

export async function listPendingEventRecommendations(
  client: Client,
  opts: { page?: number; pageSize?: number } = {},
): Promise<{ items: CommentRecommendation[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(300, Math.max(1, opts.pageSize ?? 100));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await recommendationsTable(client)
    .select(
      "id, kind, display_name, mention_count, source_channel, source_groups, directory_source, target_bucket, category_guess, notes, status, created_at, updated_at, event_at, starts_at, ends_at",
      { count: "exact" },
    )
    .eq("kind", "event")
    .eq("status", "pending")
    .order("mention_count", { ascending: false })
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (error) throw error;
  return {
    items: ((data ?? []) as CommentRecommendation[]).map((row) => ({
      ...row,
      phones: row.phones ?? [],
      instagram: row.instagram ?? [],
      websites: row.websites ?? [],
      comment_texts: row.comment_texts ?? [],
      request_snippets: row.request_snippets ?? [],
      source_post_urls: row.source_post_urls ?? [],
      source_groups: row.source_groups ?? [],
      recommender_names: row.recommender_names ?? [],
      target_bucket: row.target_bucket || "unclassified",
      directory_source: row.directory_source ?? null,
      mention_count: Number(row.mention_count ?? 1),
    })),
    total: count ?? 0,
  };
}

export async function countPendingEventRecommendations(
  client: Client,
): Promise<number> {
  const { count, error } = await recommendationsTable(client)
    .select("id", { count: "exact", head: true })
    .eq("kind", "event")
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}

function applyWhenFilter(
  events: PlatformEvent[],
  when: EventWhen,
): PlatformEvent[] {
  if (when === "all") return events;
  const now = Date.now();
  return events.filter((e) => {
    if (!e.starts_at) return when === "upcoming";
    const t = new Date(e.starts_at).getTime();
    if (Number.isNaN(t)) return when === "upcoming";
    return when === "upcoming" ? t >= now - 12 * 60 * 60 * 1000 : t < now;
  });
}

function sortEvents(events: PlatformEvent[], sort: EventSort): PlatformEvent[] {
  const copy = [...events];
  if (sort === "newest") {
    copy.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    return copy;
  }
  const asc = sort === "soon";
  copy.sort((a, b) => {
    if (!a.starts_at && !b.starts_at) return 0;
    if (!a.starts_at) return 1;
    if (!b.starts_at) return -1;
    const da = new Date(a.starts_at).getTime();
    const db = new Date(b.starts_at).getTime();
    return asc ? da - db : db - da;
  });
  return copy;
}

/** Published events linked to a business via provider_business_id. */
export async function listPublishedEventsForBusiness(
  client: Client,
  businessId: string,
  opts: { limit?: number } = {},
): Promise<PlatformEvent[]> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 40));
  const { data, error } = await eventsTable(client)
    .select(EVENT_SELECT)
    .eq("status", "published")
    .eq("provider_business_id", businessId)
    .order("starts_at", { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as PlatformEvent[];
}

export async function listPublishedEvents(
  client: Client,
  opts: {
    limit?: number;
    cities?: string[];
    sort?: EventSort;
    when?: EventWhen;
    /** ISO date YYYY-MM-DD — filter events that start on this local calendar day (Pacific). */
    onDate?: string;
    category?: string;
  } = {},
): Promise<PlatformEvent[]> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 60));
  const sort = opts.sort ?? "soon";
  const when = opts.when ?? "all";

  let query = eventsTable(client)
    .select(EVENT_SELECT)
    .eq("status", "published")
    .limit(Math.min(400, limit * 3));

  if (opts.cities && opts.cities.length > 0) {
    query = query.in("city", opts.cities);
  }
  if (opts.category?.trim()) {
    query = query.eq("category", opts.category.trim());
  }

  const { data, error } = await query;
  if (error) throw error;

  let filtered = applyWhenFilter((data ?? []) as PlatformEvent[], when);
  if (opts.onDate?.trim()) {
    filtered = filterEventsOnDate(filtered, opts.onDate.trim());
  }
  return sortEvents(filtered, sort).slice(0, limit);
}

/** Count published events per calendar day (Pacific) for the month calendar. */
export async function listPublishedEventDateCounts(
  client: Client,
  opts: { cities?: string[]; category?: string } = {},
): Promise<Record<string, number>> {
  let query = eventsTable(client)
    .select("starts_at")
    .eq("status", "published")
    .not("starts_at", "is", null)
    .limit(1000);

  if (opts.cities && opts.cities.length > 0) {
    query = query.in("city", opts.cities);
  }
  if (opts.category?.trim()) {
    query = query.eq("category", opts.category.trim());
  }

  const { data, error } = await query;
  if (error) throw error;

  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ starts_at: string | null }>) {
    if (!row.starts_at) continue;
    const key = pacificDateKey(row.starts_at);
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function pacificDateKey(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // en-CA → YYYY-MM-DD in America/Los_Angeles
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return null;
  }
}

function filterEventsOnDate(
  events: PlatformEvent[],
  ymd: string,
): PlatformEvent[] {
  return events.filter((e) => {
    if (!e.starts_at) return false;
    return pacificDateKey(e.starts_at) === ymd;
  });
}

/** Distinct cities present on published events (for region picker counts). */
export async function listPublishedEventCityCounts(
  client: Client,
): Promise<Record<string, number>> {
  const { data, error } = await eventsTable(client)
    .select("city")
    .eq("status", "published")
    .not("city", "is", null)
    .limit(500);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ city: string | null }>) {
    const city = row.city?.trim();
    if (!city) continue;
    counts[city] = (counts[city] ?? 0) + 1;
  }
  return counts;
}

export async function getPublishedEventBySlug(
  client: Client,
  slug: string,
): Promise<PlatformEvent | null> {
  const normalized = normalizeRouteSlug(slug);
  const { data, error } = await eventsTable(client)
    .select(EVENT_SELECT)
    .eq("slug", normalized)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw error;
  return (data as PlatformEvent | null) ?? null;
}
