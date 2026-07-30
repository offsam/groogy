import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type RecommendationTargetBucket =
  | "professional"
  | "business"
  | "service"
  | "other"
  | "unclassified"
  | "yellow_pages";

export type CommentRecommendation = {
  id: string;
  cluster_key: string;
  kind: "profi" | "event" | string;
  display_name: string | null;
  phones: string[];
  instagram: string[];
  websites: string[];
  mention_count: number;
  third_party_mention_count: number;
  self_ad_mention_count: number;
  comment_texts: string[];
  request_snippets: string[];
  source_post_urls: string[];
  source_groups: string[];
  category_guess: string | null;
  recommender_names: string[];
  last_posted_at: string | null;
  event_at: string | null;
  city: string | null;
  cover_image_url: string | null;
  target_bucket: RecommendationTargetBucket | string;
  directory_source: string | null;
  source_channel: string;
  status: string;
  notes: string | null;
  published_entity_type?: string | null;
  published_entity_id?: string | null;
  duplicate_of_entity_type?: string | null;
  duplicate_of_entity_id?: string | null;
  duplicate_confidence?: "suspected" | "confirmed" | string | null;
  duplicate_reason?: string | null;
  external_source?: string | null;
  external_id?: string | null;
  source_language?: string | null;
  title_original?: string | null;
  description_original?: string | null;
  venue_name?: string | null;
  address_line?: string | null;
  price_label?: string | null;
  payment_methods?: string[] | null;
  starts_at?: string | null;
  ends_at?: string | null;
  state_code?: string | null;
  category?: string | null;
  tags?: string[] | null;
  audience_label?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  registration_url?: string | null;
  created_at: string;
  updated_at: string;
};

/** Table not yet in generated Database types — use untyped from() for admin. */
function recommendationsTable(client: Client) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table pending in Database types
  return (client as SupabaseClient<any>).from("import_comment_recommendations");
}

/** Columns enough for Inbox list adapters — skips heavy arrays / geo / originals. */
const INBOX_RECOMMENDATION_SELECT =
  "id, kind, display_name, mention_count, source_channel, source_groups, directory_source, target_bucket, category_guess, notes, status, created_at, updated_at, event_at, starts_at, ends_at";

export async function listCommentRecommendations(
  client: Client,
  opts: {
    status?: string;
    page?: number;
    pageSize?: number;
    kind?: "profi" | "event" | "all";
    bucket?: RecommendationTargetBucket | "all";
    excludeBuckets?: RecommendationTargetBucket[];
    directorySource?: string;
    sourceChannel?: string;
    /** professional | business | service — filters target_bucket */
    entity?: "all" | "professional" | "business" | "service";
    /** Exact category_guess values to include */
    categoryGuesses?: string[];
    /**
     * `inbox` = slim columns for Review Center list (no comment_texts etc.).
     * Default `full` keeps existing callers intact.
     */
    selectMode?: "full" | "inbox";
  } = {},
): Promise<{ items: CommentRecommendation[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, opts.pageSize ?? 50));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const selectCols =
    opts.selectMode === "inbox" ? INBOX_RECOMMENDATION_SELECT : "*";

  let query = recommendationsTable(client)
    .select(selectCols, { count: "exact" })
    .order("mention_count", { ascending: false })
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (opts.status && opts.status !== "all") {
    query = query.eq("status", opts.status);
  }
  if (opts.kind && opts.kind !== "all") {
    query = query.eq("kind", opts.kind);
  }
  if (opts.sourceChannel) {
    query = query.eq("source_channel", opts.sourceChannel);
  }
  if (opts.entity && opts.entity !== "all") {
    query = query.eq("target_bucket", opts.entity);
  } else if (opts.bucket && opts.bucket !== "all") {
    query = query.eq("target_bucket", opts.bucket);
  } else if (opts.excludeBuckets?.length) {
    for (const b of opts.excludeBuckets) {
      query = query.neq("target_bucket", b);
    }
  }
  if (opts.directorySource) {
    query = query.eq("directory_source", opts.directorySource);
  }
  if (opts.categoryGuesses?.length) {
    query = query.in("category_guess", opts.categoryGuesses);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return {
    items: ((data ?? []) as unknown as CommentRecommendation[]).map((row) => ({
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
      third_party_mention_count: Number(row.third_party_mention_count ?? 0),
      self_ad_mention_count: Number(row.self_ad_mention_count ?? 0),
      mention_count: Number(row.mention_count ?? 1),
    })),
    total: count ?? 0,
  };
}

/** Exact pending (+ optional status/kind) count without loading rows. */
export async function countCommentRecommendations(
  client: Client,
  opts: {
    status?: string;
    kind?: "profi" | "event" | "all";
  } = {},
): Promise<number> {
  let query = recommendationsTable(client).select("id", {
    count: "exact",
    head: true,
  });
  if (opts.status && opts.status !== "all") {
    query = query.eq("status", opts.status);
  } else if (!opts.status) {
    query = query.eq("status", "pending");
  }
  if (opts.kind && opts.kind !== "all") {
    query = query.eq("kind", opts.kind);
  }
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/** Facet counts for entity type + category within a source/queue. */
export async function countRecommendationFacets(
  client: Client,
  opts: {
    status?: string;
    kind?: "profi" | "event" | "all";
    directorySource?: string;
    sourceChannel?: string;
    excludeBuckets?: RecommendationTargetBucket[];
    entity?: "all" | "professional" | "business" | "service";
  } = {},
): Promise<{
  byEntity: Record<string, number>;
  byCategoryGuess: Record<string, number>;
}> {
  let query = recommendationsTable(client).select(
    "target_bucket, category_guess",
  );
  if (opts.status && opts.status !== "all") {
    query = query.eq("status", opts.status);
  }
  if (opts.kind && opts.kind !== "all") {
    query = query.eq("kind", opts.kind);
  }
  if (opts.sourceChannel) {
    query = query.eq("source_channel", opts.sourceChannel);
  }
  if (opts.directorySource) {
    query = query.eq("directory_source", opts.directorySource);
  }
  if (opts.entity && opts.entity !== "all") {
    query = query.eq("target_bucket", opts.entity);
  } else if (opts.excludeBuckets?.length) {
    for (const b of opts.excludeBuckets) {
      query = query.neq("target_bucket", b);
    }
  }

  const { data, error } = await query;
  if (error) throw error;

  const byEntity: Record<string, number> = {
    all: 0,
    professional: 0,
    business: 0,
    service: 0,
    other: 0,
    unclassified: 0,
  };
  const byCategoryGuess: Record<string, number> = {};

  for (const row of (data ?? []) as {
    target_bucket?: string | null;
    category_guess?: string | null;
  }[]) {
    const bucket = row.target_bucket || "unclassified";
    byEntity.all += 1;
    byEntity[bucket] = (byEntity[bucket] ?? 0) + 1;
    const guess = (row.category_guess || "").trim() || "услуга / специалист";
    byCategoryGuess[guess] = (byCategoryGuess[guess] ?? 0) + 1;
  }

  return { byEntity, byCategoryGuess };
}

export async function countYellowPagesByDirectorySource(
  client: Client,
  opts: { status?: string } = {},
): Promise<Record<string, number>> {
  let query = recommendationsTable(client)
    .select("directory_source")
    .eq("target_bucket", "yellow_pages");
  if (opts.status && opts.status !== "all") {
    query = query.eq("status", opts.status);
  }
  const { data, error } = await query;
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { directory_source?: string | null }[]) {
    const key = row.directory_source?.trim() || "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export async function countCommentRecommendationsByBucket(
  client: Client,
  opts: {
    status?: string;
    kind?: "profi" | "event" | "all";
    excludeBuckets?: RecommendationTargetBucket[];
  } = {},
): Promise<Record<string, number>> {
  let query = recommendationsTable(client).select("target_bucket");
  if (opts.status && opts.status !== "all") {
    query = query.eq("status", opts.status);
  }
  if (opts.kind && opts.kind !== "all") {
    query = query.eq("kind", opts.kind);
  }
  if (opts.excludeBuckets?.length) {
    for (const b of opts.excludeBuckets) {
      query = query.neq("target_bucket", b);
    }
  }
  const { data, error } = await query;
  if (error) throw error;
  const counts: Record<string, number> = {
    all: 0,
    professional: 0,
    business: 0,
    service: 0,
    other: 0,
    unclassified: 0,
  };
  const excluded = new Set(opts.excludeBuckets ?? []);
  for (const row of (data ?? []) as { target_bucket?: string }[]) {
    const b = row.target_bucket || "unclassified";
    if (excluded.has(b as RecommendationTargetBucket)) continue;
    counts.all += 1;
    counts[b] = (counts[b] ?? 0) + 1;
  }
  return counts;
}
