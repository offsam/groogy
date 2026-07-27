import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";
import type { EventSort, EventWhen } from "@/lib/events/regions";

type Client = SupabaseClient<Database>;

/** Table not yet in generated Database types — use untyped from() for admin. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function recommendationsTable(client: Client): any {
  return (client as SupabaseClient<any>).from("import_comment_recommendations");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function eventsTable(client: Client): any {
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
  cover_image_url: string | null;
  registration_url: string | null;
  source_url: string | null;
  source_posted_at: string | null;
  source_body: string | null;
  format: string | null;
  created_at: string;
};

export async function listPendingEventRecommendations(
  client: Client,
  opts: { page?: number; pageSize?: number } = {},
): Promise<{ items: CommentRecommendation[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 100));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await recommendationsTable(client)
    .select("*", { count: "exact" })
    .eq("kind", "event")
    .eq("status", "pending")
    .order("mention_count", { ascending: false })
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (error) throw error;
  return {
    items: (data ?? []) as CommentRecommendation[],
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

export async function listPublishedEvents(
  client: Client,
  opts: {
    limit?: number;
    cities?: string[];
    sort?: EventSort;
    when?: EventWhen;
  } = {},
): Promise<PlatformEvent[]> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 60));
  const sort = opts.sort ?? "soon";
  const when = opts.when ?? "all";

  let query = eventsTable(client)
    .select(
      "id, title, slug, description, status, starts_at, ends_at, event_at_label, city, cover_image_url, registration_url, source_url, source_posted_at, source_body, format, created_at",
    )
    .eq("status", "published")
    .limit(Math.min(200, limit * 3));

  if (opts.cities && opts.cities.length > 0) {
    query = query.in("city", opts.cities);
  }

  const { data, error } = await query;
  if (error) throw error;

  const filtered = applyWhenFilter((data ?? []) as PlatformEvent[], when);
  return sortEvents(filtered, sort).slice(0, limit);
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
  const { data, error } = await eventsTable(client)
    .select(
      "id, title, slug, description, status, starts_at, ends_at, event_at_label, city, cover_image_url, registration_url, source_url, source_posted_at, source_body, format, created_at",
    )
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (error) throw error;
  return (data as PlatformEvent | null) ?? null;
}
