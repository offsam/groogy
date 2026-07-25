import { NextResponse } from "next/server";
import {
  OpenRouterError,
  parseSearchIntent,
  type SearchIntent,
} from "@/lib/ai/search-intent";
import { distanceKm } from "@/lib/geo/distance";
import {
  assertAiSearchRequestAllowed,
  clampSearchQuery,
  readAiSearchJsonBody,
} from "@/lib/security/ai-search-guard";
import {
  clientIpFromRequest,
  consumeRateLimit,
} from "@/lib/security/rate-limit";
import { safeErrorMessage } from "@/lib/security/redact";
import { createServerClient } from "@/lib/supabase/server";
import { getActiveCategories, searchBusinesses } from "@/lib/supabase/queries";
import { hasCoordinates, type Business } from "@/types/business";

export const runtime = "nodejs";

/** Tight limits so the shared OpenRouter key cannot be farmed as a general LLM. */
const AI_RATE_LIMIT = 12;
const AI_RATE_WINDOW_MS = 60_000;

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asOptionalCoord(value: unknown, kind: "lat" | "lng"): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  if (kind === "lat" && Math.abs(n) > 90) return null;
  if (kind === "lng" && Math.abs(n) > 180) return null;
  return n;
}

function hintScore(business: Business, hints: string[]): number {
  if (hints.length === 0) return 0;
  const haystack = [
    business.name,
    business.shortDescription,
    business.description,
    business.categoryName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hints.reduce(
    (sum, hint) => sum + (haystack.includes(hint.toLowerCase()) ? 1 : 0),
    0,
  );
}

/** Nearest-first when coords present; then soft hint boost; then rating. */
function rankBusinesses(
  businesses: Business[],
  hints: string[],
  near: { lat: number; lng: number } | null,
): Business[] {
  return [...businesses].sort((a, b) => {
    if (near) {
      const da = hasCoordinates(a)
        ? distanceKm(near.lat, near.lng, a.latitude, a.longitude)
        : Number.POSITIVE_INFINITY;
      const db = hasCoordinates(b)
        ? distanceKm(near.lat, near.lng, b.latitude, b.longitude)
        : Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
    }

    const hintDiff = hintScore(b, hints) - hintScore(a, hints);
    if (hintDiff !== 0) return hintDiff;
    return (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0);
  });
}

function emptyIntent(): SearchIntent {
  return { keywords: [], city: null, categorySlug: null, mustHints: [] };
}

export async function POST(request: Request) {
  const originGate = assertAiSearchRequestAllowed(request);
  if (!originGate.ok) {
    return NextResponse.json(
      { error: originGate.error },
      { status: originGate.status },
    );
  }

  const ip = clientIpFromRequest(request);
  const limited = consumeRateLimit(`ai-search:${ip}`, {
    limit: AI_RATE_LIMIT,
    windowMs: AI_RATE_WINDOW_MS,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  const parsedBody = await readAiSearchJsonBody(request);
  if (!parsedBody.ok) {
    return NextResponse.json(
      { error: parsedBody.error },
      { status: parsedBody.status },
    );
  }

  const body = parsedBody.body;
  const q = clampSearchQuery(asOptionalString(body.q) ?? "");
  const categoryOverride = asOptionalString(body.categorySlug);
  const cityOverride = asOptionalString(body.city);
  const hubId = asOptionalString(body.hubId);
  const nearLat = asOptionalCoord(body.lat, "lat");
  const nearLng = asOptionalCoord(body.lng, "lng");
  const near =
    nearLat != null && nearLng != null ? { lat: nearLat, lng: nearLng } : null;

  // Reject attempts to smuggle chat/LLM controls through the search API.
  if (
    "messages" in body ||
    "model" in body ||
    "prompt" in body ||
    "system" in body ||
    "apiKey" in body ||
    "api_key" in body
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const client = await createServerClient();
  const categories = await getActiveCategories(client);

  // No query: plain catalog listing (no LLM, no key use).
  if (!q) {
    const businesses = await searchBusinesses(client, {
      categorySlug: categoryOverride,
      city: cityOverride,
      hubId,
      nearLat,
      nearLng,
    });
    return NextResponse.json({
      businesses,
      intent: emptyIntent(),
      modelUsed: null,
      fallback: false,
      sortedByDistance: Boolean(near),
    });
  }

  let intent = emptyIntent();
  let modelUsed: string | null = null;
  let fallback = false;

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    fallback = true;
  } else {
    try {
      const parsed = await parseSearchIntent(
        q,
        categories.map((c) => ({ slug: c.slug, name: c.name })),
      );
      intent = parsed.intent;
      modelUsed = parsed.modelUsed === "none" ? null : parsed.modelUsed;
    } catch (err) {
      fallback = true;
      console.warn("[ai-search] failover:", safeErrorMessage(err));
      if (!(err instanceof OpenRouterError)) {
        console.error("[ai-search] unexpected");
      }
    }
  }

  const searchQuery = fallback
    ? q
    : (() => {
        const cityLower = intent.city?.toLowerCase() ?? "";
        const hintSet = new Set(intent.mustHints.map((h) => h.toLowerCase()));
        const tokens = intent.keywords.filter((k) => {
          const lower = k.toLowerCase();
          if (cityLower && lower === cityLower) return false;
          if (hintSet.has(lower)) return false;
          return true;
        });
        return tokens.length > 0 ? tokens.join(" ") : q;
      })();

  // County / metro names are hubs, not city ILIKE filters (Irvine ≠ "Orange County").
  const rawCity = cityOverride ?? intent.city;
  const cityForFilter = (() => {
    if (!rawCity) return null;
    const lower = rawCity.toLowerCase();
    if (
      lower.includes("orange county") ||
      lower.includes("оранж") ||
      lower === "oc" ||
      lower.includes("los angeles") ||
      lower.includes("san diego")
    ) {
      return null;
    }
    return rawCity;
  })();

  // Prefer mustHints for ranking only; also fold language hints into soft boost.
  // If hard keyword AND returns empty, retry with fewer tokens (drop redundant ones).
  const searchParams = {
    categorySlug: categoryOverride ?? intent.categorySlug,
    city: cityForFilter,
    hubId,
    nearLat,
    nearLng,
  };

  let businesses = await searchBusinesses(client, {
    ...searchParams,
    query: searchQuery,
  });

  if (businesses.length === 0 && searchQuery) {
    const tokens = searchQuery.split(/\s+/).filter(Boolean);
    if (tokens.length > 1) {
      // Retry with the longest / most specific token only.
      const primary = [...tokens].sort((a, b) => b.length - a.length)[0];
      businesses = await searchBusinesses(client, {
        ...searchParams,
        query: primary,
      });
    }
  }

  if (businesses.length === 0 && (categoryOverride ?? intent.categorySlug)) {
    // Last resort: category + hub, no text tokens.
    businesses = await searchBusinesses(client, searchParams);
  }

  const softHints = fallback
    ? []
    : [
        ...intent.mustHints,
        ...intent.keywords.filter((k) =>
          ["русский", "russian", "украинский", "ukrainian"].includes(
            k.toLowerCase(),
          ),
        ),
      ];

  const ranked = rankBusinesses(businesses, softHints, near);

  return NextResponse.json({
    businesses: ranked,
    intent: fallback
      ? {
          ...emptyIntent(),
          keywords: q
            .split(/[^\p{L}\p{N}]+/u)
            .map((t) => t.trim())
            .filter((t) => t.length >= 2)
            .slice(0, 8),
        }
      : intent,
    modelUsed,
    fallback,
    sortedByDistance: Boolean(near),
  });
}
