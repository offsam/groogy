import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Listing } from "@/types/listing";
import { mapListing, mapMedia } from "@/lib/listings/mappers";
import { signListingMediaUrls } from "@/lib/listings/media";
import {
  expandSearchToken,
  haystackMatchesToken,
} from "@/lib/search/synonyms";
import { extractSubjectAnchors } from "@/lib/search/subject-anchors";
import { tryCreateServiceRoleClient } from "@/lib/supabase/service";
import type { UserSearchHistoryFrame } from "@/types/profile-cabinet";

type Client = SupabaseClient<Database>;

function untyped(client: Client) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new tables lag Database types
  return client as unknown as import("@supabase/supabase-js").SupabaseClient<any>;
}

const LISTING_CARD_SELECT = `
  id, owner_id, listing_type, status, visibility, author_visibility,
  title, description, price_amount, price_currency, is_negotiable,
  city, state, state_code, city_geoid, county_geoid,
  publisher_type, publisher_business_id,
  published_at, created_at, updated_at, expires_at,
  marketplace_listing_details (
    category_id, condition, transaction_type,
    delivery_available, pickup_available, quantity
  ),
  service_listing_details (
    service_category_id, pricing_type, price_from, price_to,
    price_unit, service_modes, service_area
  ),
  listing_media (
    id, listing_id, storage_path, sort_order, media_type, width, height, created_at
  )
`;

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().slice(0, 80);
}

/** Persist a search for the cabinet feed (table if present; always ok if only platform_events). */
export async function recordUserSearchHistory(
  userId: string,
  query: string,
): Promise<void> {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return;
  if (/^https?:\/\//i.test(q) || /[0-9]{7,}/.test(q)) return;

  const catalog = tryCreateServiceRoleClient();
  if (!catalog) return;

  const norm = normalizeQuery(q);
  const db = untyped(catalog);

  const { data: existing } = await db
    .from("user_search_history")
    .select("id, hit_count")
    .eq("user_id", userId)
    .eq("query_normalized", norm)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await db
      .from("user_search_history")
      .update({
        query: q,
        hit_count: (existing.hit_count ?? 0) + 1,
        last_searched_at: new Date().toISOString(),
        dismissed_at: null,
      })
      .eq("id", existing.id);
    if (error) {
      console.warn("[search-history] update failed:", error.message);
    }
    return;
  }

  const { error } = await db.from("user_search_history").insert({
    user_id: userId,
    query: q,
    query_normalized: norm,
    hit_count: 1,
    last_searched_at: new Date().toISOString(),
    dismissed_at: null,
  });
  if (error) {
    // Table may not exist yet — platform_events still logs the search.
    console.warn("[search-history] insert failed:", error.message);
  }
}

async function listFromUserSearchHistoryTable(
  client: Client,
  userId: string,
  limit: number,
): Promise<UserSearchHistoryFrame[] | null> {
  const { data, error } = await untyped(client)
    .from("user_search_history")
    .select("id, query, query_normalized, hit_count, last_searched_at")
    .eq("user_id", userId)
    .is("dismissed_at", null)
    .order("last_searched_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("[search-history] table read failed:", error.message);
    return null;
  }
  return (data ?? []).map(
    (row: {
      id: string;
      query: string;
      query_normalized: string;
      hit_count: number;
      last_searched_at: string;
    }) => ({
      id: row.id,
      query: row.query,
      queryNormalized: row.query_normalized,
      hitCount: row.hit_count,
      lastSearchedAt: row.last_searched_at,
    }),
  );
}

/** Fallback while migration is not applied: aggregate platform_events searches. */
async function listFromPlatformEvents(
  userId: string,
  limit: number,
  dismissedNorms: Set<string>,
): Promise<UserSearchHistoryFrame[]> {
  const catalog = tryCreateServiceRoleClient();
  if (!catalog) return [];

  const { data, error } = await untyped(catalog)
    .from("platform_events")
    .select("id, meta, created_at")
    .eq("event_type", "search")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.warn("[search-history] platform_events read failed:", error.message);
    return [];
  }

  const byNorm = new Map<
    string,
    { query: string; hitCount: number; lastSearchedAt: string; id: string }
  >();

  for (const row of data ?? []) {
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    const raw = typeof meta.q === "string" ? meta.q.trim() : "";
    if (raw.length < 2) continue;
    const norm = normalizeQuery(raw);
    if (dismissedNorms.has(norm)) continue;
    const prev = byNorm.get(norm);
    if (prev) {
      prev.hitCount += 1;
    } else {
      byNorm.set(norm, {
        id: `pe:${norm}`,
        query: raw.slice(0, 80),
        hitCount: 1,
        lastSearchedAt: row.created_at as string,
      });
    }
  }

  return [...byNorm.values()]
    .sort(
      (a, b) =>
        new Date(b.lastSearchedAt).getTime() -
        new Date(a.lastSearchedAt).getTime(),
    )
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      query: row.query,
      queryNormalized: normalizeQuery(row.query),
      hitCount: row.hitCount,
      lastSearchedAt: row.lastSearchedAt,
    }));
}

export async function listActiveSearchHistory(
  client: Client,
  userId: string,
  limit = 12,
  dismissedNorms: string[] = [],
): Promise<UserSearchHistoryFrame[]> {
  const dismissed = new Set(dismissedNorms.map(normalizeQuery));

  const fromTable = await listFromUserSearchHistoryTable(client, userId, limit);
  if (fromTable && fromTable.length > 0) {
    return fromTable.filter((f) => !dismissed.has(f.queryNormalized));
  }

  // Empty table or missing migration → use logged platform_events (user_id set on search).
  return listFromPlatformEvents(userId, limit, dismissed);
}

/** Filler words — not useful alone for listing recall. */
const LISTING_QUERY_STOP = new Set([
  "по",
  "для",
  "в",
  "на",
  "с",
  "и",
  "или",
  "the",
  "a",
  "an",
  "of",
  "to",
  "for",
  "in",
  "on",
  "near",
  "me",
  "need",
  "нужен",
  "нужна",
  "нужно",
  "нужны",
  "ищу",
  "найти",
  "хочу",
  "looking",
  "find",
  "want",
]);

function escapeIlike(value: string): string {
  return value.replace(/[%_,.()]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Content tokens for soft listing match: drop stopwords, keep stems ≥3 chars.
 * Prefer distinctive tokens (longer first) so OR-query stays small.
 */
function listingQueryTokens(query: string): string[] {
  const raw = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !LISTING_QUERY_STOP.has(t));

  const unique = [...new Set(raw)];
  // Prefer longer / more specific tokens first (испанскому before по…).
  unique.sort((a, b) => b.length - a.length || a.localeCompare(b));
  return unique.slice(0, 6);
}

/** Variants to OR into PostgREST ilike (token + a few synonyms). */
function listingIlikeVariants(tokens: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    // Cap synonyms per token so .or() stays under URL limits.
    for (const v of expandSearchToken(token).slice(0, 4)) {
      const clean = escapeIlike(v);
      if (clean.length < 3 || seen.has(clean)) continue;
      seen.add(clean);
      out.push(clean);
      if (out.length >= 12) return out;
    }
  }
  return out;
}

function scoreListingAgainstQuery(
  title: string,
  description: string,
  tokens: string[],
  subjects: string[],
): number {
  const hay = `${title} ${description}`.toLowerCase();
  if (!hay.trim()) return 0;

  let score = 0;
  let matchedTokens = 0;
  for (const token of tokens) {
    if (haystackMatchesToken(hay, token)) {
      matchedTokens += 1;
      // Longer tokens (subject / specialty) weigh more than short generics.
      score += Math.min(token.length, 12);
      if (title.toLowerCase().includes(token) || haystackMatchesToken(title, token)) {
        score += 4;
      }
    }
  }

  if (matchedTokens === 0) return 0;

  // Soft subject boost: prefer Spanish tutors over unrelated «репетитор»,
  // but do not zero-out cards that only match the trade word.
  if (subjects.length > 0) {
    const subjectHit = subjects.some((s) => haystackMatchesToken(hay, s));
    score += subjectHit ? 20 : -4;
  }

  // Multi-token overlap (репетитор + испанский) beats single weak hit.
  score += matchedTokens * 6;
  return score;
}

export async function searchListingsForQuery(
  client: Client,
  query: string,
  limit = 8,
): Promise<Listing[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const tokens = listingQueryTokens(q);
  if (tokens.length === 0) return [];

  const variants = listingIlikeVariants(tokens);
  if (variants.length === 0) return [];

  const subjects = extractSubjectAnchors(q, tokens);
  const catalog = tryCreateServiceRoleClient() ?? client;

  // OR across tokens/synonyms — phrase-exact was too strict for real ads.
  const orFilter = variants
    .flatMap((v) => [`title.ilike.%${v}%`, `description.ilike.%${v}%`])
    .join(",");

  const fetchLimit = Math.min(Math.max(limit * 5, 24), 40);
  const { data, error } = await untyped(catalog)
    .from("listings")
    .select(LISTING_CARD_SELECT)
    .eq("status", "active")
    .eq("visibility", "public")
    .in("listing_type", ["marketplace_item", "service"])
    .or(orFilter)
    .order("published_at", { ascending: false })
    .limit(fetchLimit);

  if (error) {
    console.warn("[search-history] listings lookup failed:", error.message);
    return [];
  }

  type Row = {
    id: string;
    title?: string | null;
    description?: string | null;
    listing_media?: Array<{
      id: string;
      listing_id: string;
      storage_path: string;
      sort_order: number;
    }>;
    published_at?: string | null;
  };

  const scored = ((data ?? []) as Row[])
    .map((row) => ({
      row,
      score: scoreListingAgainstQuery(
        row.title ?? "",
        row.description ?? "",
        tokens,
        subjects,
      ),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ta = a.row.published_at ? Date.parse(a.row.published_at) : 0;
      const tb = b.row.published_at ? Date.parse(b.row.published_at) : 0;
      return tb - ta;
    })
    .slice(0, limit);

  const listings: Listing[] = [];
  for (const { row } of scored) {
    const mediaRows = (row.listing_media ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((m) => ({
        id: m.id,
        listingId: m.listing_id,
        storagePath: m.storage_path,
        sortOrder: m.sort_order,
      }));
    const signed = await signListingMediaUrls(catalog, mediaRows);
    listings.push(
      mapListing(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        row as any,
        signed.length
          ? signed
          : mediaRows.map((m) =>
              mapMedia(
                {
                  id: m.id,
                  listing_id: m.listingId,
                  storage_path: m.storagePath,
                  media_type: "image",
                  sort_order: m.sortOrder,
                  width: null,
                  height: null,
                  created_at: "",
                },
                null,
              ),
            ),
        null,
        false,
        "",
      ),
    );
  }
  return listings;
}

export type SearchFrameWithListings = UserSearchHistoryFrame & {
  listings: Listing[];
};

export async function listSearchFramesWithListings(
  client: Client,
  userId: string,
  dismissedNorms: string[] = [],
): Promise<SearchFrameWithListings[]> {
  const frames = await listActiveSearchHistory(
    client,
    userId,
    10,
    dismissedNorms,
  );
  const withListings = await Promise.all(
    frames.map(async (frame) => ({
      ...frame,
      listings: await searchListingsForQuery(client, frame.query, 8),
    })),
  );
  return withListings;
}
