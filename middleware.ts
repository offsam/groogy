import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { updateSession } from "@/lib/supabase/middleware";
import { normalizeSupabaseUrl } from "@/lib/supabase/env";

const CARD_PATH_RE =
  /^\/(business|professional|marketplace|jobs|events|lechu|transfers|services|real-estate)\/([^/]+)\/?$/;

const ENTITY_MOVE_LOOKUP_TIMEOUT_MS = 2000;
/** entity_moves only changes when an admin merges/moves a card — a 60s-stale
 * redirect table is an easy trade for cutting a DB round-trip off every
 * single card-page request. Matches the TTL convention used for the other
 * catalog aggregates (see lib/platform/catalog-cache.ts). */
const ENTITY_MOVES_CACHE_TTL_MS = 60_000;

let entityMovesCache: Map<string, string> | null = null;
let entityMovesCacheAt = 0;
let entityMovesRefreshPromise: Promise<Map<string, string>> | null = null;

async function fetchEntityMovesMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return map;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ENTITY_MOVE_LOOKUP_TIMEOUT_MS);
  try {
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: controller.signal }) },
    });
    // Table is small (redirect records only) — pull it whole instead of
    // querying per from_path. Oldest-first so a later re-move of the same
    // card overwrites the earlier redirect in the map.
    const { data } = await supabase
      .from("entity_moves")
      .select("from_path, to_path, created_at")
      .order("created_at", { ascending: true })
      .limit(5000);
    for (const row of data ?? []) {
      const fromPath = (row as { from_path?: unknown }).from_path;
      const toPath = (row as { to_path?: unknown }).to_path;
      if (
        typeof fromPath === "string" &&
        typeof toPath === "string" &&
        toPath.startsWith("/") &&
        !toPath.startsWith("//")
      ) {
        map.set(fromPath, toPath);
      }
    }
  } catch {
    // Fall through with whatever we managed to collect (possibly empty) —
    // caller treats a miss as "no redirect", same as before this cache existed.
  } finally {
    clearTimeout(timeout);
  }
  return map;
}

/**
 * Was a live Postgres query on every single card-page request (before any
 * rendering could start), for the 99.9% of cards that were never moved.
 * Now backed by a whole-table in-memory cache per warm middleware instance,
 * refreshed at most once per ENTITY_MOVES_CACHE_TTL_MS: warm requests do a
 * plain Map lookup (no network call at all); a cold instance pays the same
 * one-time DB round-trip as before, then serves from memory.
 */
async function lookupEntityMoveRedirect(
  fromPath: string,
): Promise<string | null> {
  const now = Date.now();
  const isStale =
    !entityMovesCache || now - entityMovesCacheAt > ENTITY_MOVES_CACHE_TTL_MS;

  if (isStale && !entityMovesRefreshPromise) {
    entityMovesRefreshPromise = fetchEntityMovesMap().then((map) => {
      entityMovesCache = map;
      entityMovesCacheAt = Date.now();
      entityMovesRefreshPromise = null;
      return map;
    });
  }

  // Nothing cached yet (cold instance) — this request has to wait for the
  // fetch, same as the old per-request query did. Once warm, stale cache is
  // still served immediately while the refresh above completes in the background.
  if (!entityMovesCache && entityMovesRefreshPromise) {
    entityMovesCache = await entityMovesRefreshPromise;
  }

  return entityMovesCache?.get(fromPath) ?? null;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname.replace(/\/$/, "") || "/";
  if (CARD_PATH_RE.test(pathname)) {
    const toPath = await lookupEntityMoveRedirect(pathname);
    if (toPath && toPath !== pathname) {
      const dest = request.nextUrl.clone();
      dest.pathname = toPath;
      return NextResponse.redirect(dest, 308);
    }
  }

  try {
    return await updateSession(request);
  } catch {
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
