import { NextResponse } from "next/server";
import {
  OpenRouterError,
  parseSearchIntent,
  type SearchIntent,
} from "@/lib/ai/search-intent";
import { distanceKm } from "@/lib/geo/distance";
import {
  correctSearchText,
  correctTokenList,
  type SpellCorrection,
} from "@/lib/search/spellcheck";
import { haystackMatchesToken } from "@/lib/search/synonyms";
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
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createServerClient } from "@/lib/supabase/server";
import { getActiveCategories, searchBusinesses } from "@/lib/supabase/queries";
import { compareBusinessesByCompleteness } from "@/lib/business/completeness";
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
  const name = (business.name ?? "").toLowerCase();
  const haystack = [
    business.name,
    business.shortDescription,
    business.description,
    business.categoryName,
    business.categorySlug,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hints.reduce((sum, hint) => {
    const lower = hint.toLowerCase();
    // Exact phrase in name beats weak synonym hits elsewhere (пол/tile).
    if (name.includes(lower)) return sum + 6;
    if (haystack.includes(lower)) return sum + 3;
    if (haystackMatchesToken(haystack, hint)) return sum + 1;
    return sum;
  }, 0);
}

/** Nearest-first when coords present; then soft hint boost; then completeness. */
function rankBusinesses(
  businesses: Business[],
  hints: string[],
  near: { lat: number; lng: number } | null,
): Business[] {
  return [...businesses].sort((a, b) => {
    // Explicit service matches first (oil on card beats generic auto shop).
    const hintDiff = hintScore(b, hints) - hintScore(a, hints);
    if (hintDiff !== 0) return hintDiff;

    if (near) {
      const da = hasCoordinates(a)
        ? distanceKm(near.lat, near.lng, a.latitude, a.longitude)
        : Number.POSITIVE_INFINITY;
      const db = hasCoordinates(b)
        ? distanceKm(near.lat, near.lng, b.latitude, b.longitude)
        : Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
    }

    return compareBusinessesByCompleteness(a, b);
  });
}

function emptyIntent(): SearchIntent {
  return {
    keywords: [],
    city: null,
    categorySlug: null,
    mustHints: [],
    preferCategory: false,
    nearMe: false,
  };
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
  const catalog = createServiceRoleClient();
  const categories = await getActiveCategories(client);

  // No query: plain catalog listing (no LLM, no key use).
  if (!q) {
    const businesses = await searchBusinesses(catalog, {
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
      corrections: [],
    });
  }

  // Deterministic typo fix (floring → flooring) before/alongside LLM.
  const querySpell = correctSearchText(q);
  const qForLlm = querySpell.corrected || q;
  const corrections: SpellCorrection[] = [...querySpell.corrections];

  let intent = emptyIntent();
  let modelUsed: string | null = null;
  let fallback = false;

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    fallback = true;
  } else {
    try {
      const parsed = await parseSearchIntent(
        qForLlm,
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

  // Spell-correct LLM tokens too (in case model kept the typo).
  {
    const kw = correctTokenList(intent.keywords);
    const hints = correctTokenList(intent.mustHints);
    intent = {
      ...intent,
      keywords: kw.tokens,
      mustHints: hints.tokens,
    };
    corrections.push(...kw.corrections, ...hints.corrections);
  }

  // Heuristic: obvious trade typos → search the corrected trade term (not empty category browse).
  if (
    corrections.some((c) =>
      ["flooring", "plumbing", "electrician", "roofing", "painting", "painter"].includes(
        c.to,
      ),
    )
  ) {
    const tradeTerms = corrections
      .map((c) => c.to)
      .filter((t) =>
        ["flooring", "plumbing", "electrician", "roofing", "painting", "painter"].includes(
          t,
        ),
      );
    intent = {
      ...intent,
      preferCategory: false,
      categorySlug: intent.categorySlug,
      mustHints: [...new Set([...intent.mustHints, ...tradeTerms, ...intent.keywords])],
      keywords:
        intent.keywords.length > 0
          ? intent.keywords
          : tradeTerms,
    };
  }

  const searchQuery = fallback
    ? qForLlm
    : (() => {
        // Service-need mode: browse category, don't require exact phrase on cards.
        // If we also have specific trade hints (flooring), prefer those over empty browse.
        if (intent.preferCategory && intent.categorySlug) {
          if (intent.mustHints.length > 0) {
            return intent.mustHints.slice(0, 3).join(" ");
          }
          return "";
        }
        const cityLower = intent.city?.toLowerCase() ?? "";
        const hintSet = new Set(intent.mustHints.map((h) => h.toLowerCase()));
        const tokens = intent.keywords.filter((k) => {
          const lower = k.toLowerCase();
          if (cityLower && lower === cityLower) return false;
          if (hintSet.has(lower)) return false;
          return true;
        });
        if (tokens.length > 0) return tokens.join(" ");
        if (intent.mustHints.length > 0) return intent.mustHints.slice(0, 3).join(" ");
        // Prefer corrected query over raw typo when LLM returned nothing useful.
        return qForLlm;
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

  const categorySlug = categoryOverride ?? intent.categorySlug;
  const searchParams = {
    categorySlug,
    city: cityForFilter,
    hubId,
    nearLat,
    nearLng,
  };

  let businesses = await searchBusinesses(catalog, {
    ...searchParams,
    query: searchQuery,
  });

  // If text search was too strict, widen: primary token, then category browse.
  if (businesses.length === 0 && searchQuery) {
    const tokens = searchQuery.split(/\s+/).filter(Boolean);
    if (tokens.length > 1) {
      const primary = [...tokens].sort((a, b) => b.length - a.length)[0];
      businesses = await searchBusinesses(catalog, {
        ...searchParams,
        query: primary,
      });
    }
  }

  if (businesses.length === 0 && categorySlug) {
    businesses = await searchBusinesses(catalog, searchParams);
  }

  // Always pull hint-based matches (flooring on card) and merge on top of category browse.
  const hintTerms = [
    ...intent.mustHints,
    ...(searchQuery ? searchQuery.split(/\s+/).filter(Boolean) : []),
    ...corrections.map((c) => c.to),
  ].filter(Boolean);
  if (hintTerms.length > 0) {
    const hintQuery = [...new Set(hintTerms)].slice(0, 4).join(" ");
    const extras = await searchBusinesses(catalog, {
      query: hintQuery,
      city: cityForFilter,
      hubId,
      nearLat,
      nearLng,
    });
    const seen = new Set(businesses.map((b) => b.id));
    for (const extra of extras) {
      if (seen.has(extra.id)) continue;
      if (
        categorySlug &&
        intent.preferCategory &&
        extra.categorySlug &&
        extra.categorySlug !== categorySlug &&
        !(categorySlug === "auto" && extra.categorySlug === "services") &&
        !(categorySlug === "services" && extra.categorySlug === "auto")
      ) {
        // Still allow extras that strongly match the hint text.
        const hay = [
          extra.name,
          extra.shortDescription,
          extra.description,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const strong = hintTerms.some((h) => haystackMatchesToken(hay, h));
        if (!strong) continue;
      }
      seen.add(extra.id);
      businesses.push(extra);
    }
  }

  // Last resort: corrected free-text across all categories in hub.
  if (businesses.length === 0 && qForLlm && qForLlm !== searchQuery) {
    businesses = await searchBusinesses(catalog, {
      query: qForLlm,
      city: cityForFilter,
      hubId,
      nearLat,
      nearLng,
    });
  }

  const softHints = [
    ...intent.mustHints,
    ...corrections.map((c) => c.to),
    ...intent.keywords.filter((k) =>
      ["русский", "russian", "украинский", "ukrainian"].includes(k.toLowerCase()),
    ),
  ];

  let ranked = rankBusinesses(businesses, softHints, near);

  // When we have trade/service hints and some cards match them, drop unrelated noise.
  if (softHints.length > 0) {
    const withScores = ranked.map((b) => ({ b, s: hintScore(b, softHints) }));
    const strong = withScores.filter((x) => x.s >= 3).map((x) => x.b);
    const any = withScores.filter((x) => x.s > 0).map((x) => x.b);
    if (strong.length > 0) ranked = strong;
    else if (any.length > 0) ranked = any;
  }

  // Deduplicate corrections for UI
  const seenCorr = new Set<string>();
  const uniqueCorrections = corrections.filter((c) => {
    const key = `${c.from.toLowerCase()}→${c.to.toLowerCase()}`;
    if (seenCorr.has(key)) return false;
    seenCorr.add(key);
    return c.from.toLowerCase() !== c.to.toLowerCase();
  });

  return NextResponse.json({
    businesses: ranked,
    intent: fallback
      ? {
          ...emptyIntent(),
          keywords: qForLlm
            .split(/[^\p{L}\p{N}]+/u)
            .map((t) => t.trim())
            .filter((t) => t.length >= 2)
            .slice(0, 8),
        }
      : intent,
    modelUsed,
    fallback,
    sortedByDistance: Boolean(near || intent.nearMe),
    preferCategory: intent.preferCategory,
    corrections: uniqueCorrections,
    correctedQuery: uniqueCorrections.length > 0 ? qForLlm : null,
  });
}
