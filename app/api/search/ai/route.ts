import { NextResponse } from "next/server";
import {
  enrichSearchIntent,
  OpenRouterError,
  parseSearchIntent,
  type SearchIntent,
  type SearchQueryMode,
} from "@/lib/ai/search-intent";
import { distanceKm } from "@/lib/geo/distance";
import { normalizeSearchQueryInput } from "@/lib/search/normalize-query";
import {
  mergePreparseIntoIntent,
  preparseSearchQuery,
} from "@/lib/search/query-understand";
import {
  correctSearchText,
  correctTokenList,
  type SpellCorrection,
} from "@/lib/search/spellcheck";
import { expandSearchToken, haystackMatchesToken } from "@/lib/search/synonyms";
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
  const address = [business.addressLine, business.city]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const phoneDigits = (business.phone ?? "").replace(/\D/g, "");
  const haystack = [
    business.name,
    business.shortDescription,
    business.description,
    business.categoryName,
    business.categorySlug,
    business.addressLine,
    business.city,
    business.phone,
    phoneDigits,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hints.reduce((sum, hint) => {
    const lower = hint.toLowerCase();
    // Exact phrase in name beats weak synonym hits elsewhere (пол/tile).
    if (name.includes(lower)) return sum + 6;
    // Street / city match is what address pastes need.
    if (address.includes(lower)) return sum + 5;
    if (/^\d{7,10}$/.test(lower) && phoneDigits.includes(lower)) return sum + 8;
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

function emptyIntent(queryMode: SearchQueryMode = "specialty"): SearchIntent {
  return {
    keywords: [],
    city: null,
    categorySlug: null,
    mustHints: [],
    preferCategory: false,
    nearMe: false,
    queryMode,
  };
}

/**
 * DB text search AND-matches every whitespace token. Bilingual hint lists like
 * "масло oil oil change" would require the literal word "change" on every card.
 * Pick one primary term; synonym expansion covers RU↔EN variants.
 */
function pickPrimarySearchTerm(terms: string[]): string {
  const cleaned = [
    ...new Set(
      terms
        .map((t) => t.trim().toLowerCase().replace(/\s+/g, " "))
        .filter((t) => t.length >= 2),
    ),
  ];
  if (cleaned.length === 0) return "";

  const scoreTerm = (term: string): number => {
    const parts = term.split(/\s+/).filter(Boolean);
    // Prefer single tokens that sit in a synonym group (strong bilingual recall).
    if (parts.length === 1) {
      const expanded = expandSearchToken(parts[0]);
      const bilingual = expanded.length > 1 ? 40 : 0;
      return bilingual + Math.min(parts[0].length, 12);
    }
    // Multi-word phrases: score by first content word’s synonym strength.
    const head = parts[0];
    const expanded = expandSearchToken(head);
    return (expanded.length > 1 ? 25 : 0) + Math.min(term.length, 16);
  };

  const best = [...cleaned].sort((a, b) => scoreTerm(b) - scoreTerm(a))[0];
  // If best is a phrase, use its head token so AND-search doesn't require "change".
  if (best.includes(" ")) {
    const head = best.split(/\s+/).find((p) => p.length >= 3) ?? best.split(/\s+/)[0];
    return head;
  }
  return best;
}

function buildSearchQueryFromIntent(
  intent: SearchIntent,
  qForLlm: string,
  fallback: boolean,
): string {
  if (fallback) return qForLlm;

  if (intent.queryMode === "business_name") {
    const nameTerms = [
      ...new Set(
        [...intent.keywords, ...intent.mustHints]
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length >= 2 && !t.includes(" ")),
      ),
    ];
    // Person / brand: "Максим Дегтярь" → AND both tokens (not just "максим").
    const letterNames = nameTerms.filter((t) => /^\p{L}+$/u.test(t));
    if (letterNames.length >= 2 && letterNames.length <= 4) {
      return letterNames.slice(0, 3).join(" ");
    }
    return pickPrimarySearchTerm(nameTerms) || qForLlm;
  }

  // Service-need / browse: category browse + one primary service term.
  if (intent.preferCategory && intent.categorySlug) {
    if (intent.mustHints.length > 0) {
      return pickPrimarySearchTerm(intent.mustHints);
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
  if (tokens.length > 0) return pickPrimarySearchTerm(tokens);
  if (intent.mustHints.length > 0) {
    return pickPrimarySearchTerm(intent.mustHints);
  }
  return qForLlm;
}

async function safeSearchBusinesses(
  catalog: ReturnType<typeof createServiceRoleClient>,
  params: Parameters<typeof searchBusinesses>[1],
): Promise<Business[]> {
  try {
    return await searchBusinesses(catalog, params);
  } catch (err) {
    console.warn("[ai-search] catalog query failed:", safeErrorMessage(err));
    return [];
  }
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
  const rawQ = asOptionalString(body.q) ?? "";
  const normalized = normalizeSearchQueryInput(rawQ);
  const q = clampSearchQuery(normalized.query);
  const categoryOverride = asOptionalString(body.categorySlug);
  const cityOverride = asOptionalString(body.city);
  const hubId = asOptionalString(body.hubId);
  const nearLat =
    asOptionalCoord(body.lat, "lat") ??
    (normalized.lat != null ? normalized.lat : null);
  const nearLng =
    asOptionalCoord(body.lng, "lng") ??
    (normalized.lng != null ? normalized.lng : null);
  const near =
    nearLat != null && nearLng != null ? { lat: nearLat, lng: nearLng } : null;
  const isAddressPaste =
    normalized.kind === "address" || normalized.kind === "maps_url";
  const mapsLinkUnresolved =
    normalized.kind === "maps_url" &&
    !normalized.placeName &&
    !normalized.street &&
    normalized.addressSearchTerms.length === 0;

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

  // Short goo.gl links can't be resolved without an outbound fetch — don't crash/search the URL.
  if (mapsLinkUnresolved) {
    return NextResponse.json({
      businesses: [],
      intent: emptyIntent("business_name"),
      modelUsed: null,
      fallback: false,
      sortedByDistance: false,
      preferCategory: false,
      corrections: [],
      correctedQuery: null,
      message:
        "Короткая ссылка Google Maps не раскрывается. Вставьте полный адрес или название места.",
    });
  }

  const client = await createServerClient();
  const catalog = createServiceRoleClient();
  const categories = await getActiveCategories(client);

  // No query: plain catalog listing (no LLM, no key use).
  if (!q) {
    const businesses = await safeSearchBusinesses(catalog, {
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

  // Deterministic understanding of messy input (handles, phones, translit, cities…).
  // Always run on the original paste so nearMe/city survive address normalization.
  const preparse = preparseSearchQuery(
    isAddressPaste ? normalized.original : normalized.original || q,
  );
  const isIdentityPaste =
    !isAddressPaste &&
    (preparse.kind === "phone" ||
      preparse.kind === "social_handle" ||
      preparse.kind === "website");

  // Deterministic typo fix (floring → flooring) before/alongside LLM.
  // Skip spellcheck on address/maps/identity pastes.
  const llmSeed = isIdentityPaste
    ? preparse.forLlm
    : isAddressPaste
      ? q
      : preparse.forLlm || q;
  const querySpell =
    isAddressPaste || isIdentityPaste
      ? { corrected: llmSeed, corrections: [] as SpellCorrection[] }
      : correctSearchText(llmSeed);
  const qForLlm = querySpell.corrected || llmSeed;
  const corrections: SpellCorrection[] = [...querySpell.corrections];

  let intent = emptyIntent();
  let modelUsed: string | null = null;
  let fallback = false;

  // Identity pastes are deterministic — skip LLM (saves latency/key, avoids hallucinations).
  if (isIdentityPaste) {
    intent = {
      keywords: preparse.keywords,
      city: cityOverride ?? preparse.city,
      categorySlug: null,
      mustHints: preparse.mustHints,
      preferCategory: false,
      nearMe: preparse.nearMe,
      queryMode: "business_name",
    };
  } else if (!process.env.OPENROUTER_API_KEY?.trim()) {
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

  // LLM down / failed → rebuild from deterministic preparse when possible.
  if (fallback && !isAddressPaste && !isIdentityPaste) {
    if (preparse.queryMode || preparse.mustHints.length > 0 || preparse.city) {
      intent = {
        keywords: preparse.keywords,
        city: cityOverride ?? preparse.city,
        categorySlug:
          preparse.categorySlug &&
          categories.some((c) => c.slug === preparse.categorySlug)
            ? preparse.categorySlug
            : null,
        mustHints: preparse.mustHints,
        preferCategory: Boolean(preparse.preferCategory),
        nearMe: preparse.nearMe,
        queryMode: preparse.queryMode ?? "specialty",
      };
      // Soft-fallback: we still have structure, don't treat as raw free-text only.
      if (intent.mustHints.length > 0 || intent.categorySlug) {
        fallback = false;
      }
    }
  }

  // Merge preparse gaps (city/nearMe/translit hints) into LLM intent.
  if (!isAddressPaste) {
    const allowedSlugs = new Set(categories.map((c) => c.slug));
    intent = mergePreparseIntoIntent(intent, preparse, allowedSlugs);
  }

  // Address / Maps paste: force structured location intent even if LLM flaked.
  if (isAddressPaste) {
    const addressHints = [
      ...normalized.addressSearchTerms,
      ...(normalized.placeName
        ? normalized.placeName.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2)
        : []),
    ];
    const uniqueHints = [...new Set(addressHints.map((h) => h.toLowerCase()))];
    intent = enrichSearchIntent({
      ...intent,
      queryMode: normalized.placeName ? "business_name" : "specialty",
      preferCategory: false,
      categorySlug: null,
      city: cityOverride ?? normalized.city ?? intent.city,
      keywords:
        uniqueHints.length > 0
          ? uniqueHints.slice(0, 8)
          : intent.keywords,
      mustHints:
        uniqueHints.length > 0
          ? uniqueHints.slice(0, 12)
          : intent.mustHints,
      nearMe: intent.nearMe || preparse.nearMe,
    });
  }

  // Spell-correct LLM tokens too (in case model kept the typo).
  // Skip for address/maps/identity pastes — street names / handles are not trade vocabulary.
  if (!isAddressPaste && !isIdentityPaste) {
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
    !isAddressPaste &&
    !isIdentityPaste &&
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
      queryMode:
        intent.queryMode === "business_name" ? "specialty" : intent.queryMode === "browse"
          ? "service_need"
          : intent.queryMode,
      preferCategory: false,
      categorySlug: intent.categorySlug,
      mustHints: [...new Set([...intent.mustHints, ...tradeTerms, ...intent.keywords])],
      keywords:
        intent.keywords.length > 0
          ? intent.keywords
          : tradeTerms,
    };
  }

  // Re-expand RU↔EN after corrections so "масло" still pulls "oil" etc.
  // Address/identity pastes keep structured tokens — don't synonym-dilute them.
  if (!isAddressPaste && !isIdentityPaste) {
    intent = enrichSearchIntent(intent);
  }

  let searchQuery = buildSearchQueryFromIntent(intent, qForLlm, fallback);
  if (isAddressPaste) {
    const terms = normalized.addressSearchTerms.filter(
      (t) => !/^\d{5}(?:-\d{4})?$/.test(t),
    );
    const house = terms.find((t) => /^\d{1,6}$/.test(t));
    const cityLower = (normalized.city ?? "").toLowerCase();
    const streetWord = terms.find(
      (t) => !/^\d+$/.test(t) && t.length >= 3 && t !== cityLower,
    );
    if (normalized.placeName && !/^\d{1,6}\s/.test(normalized.placeName)) {
      searchQuery = pickPrimarySearchTerm([
        normalized.placeName,
        ...normalized.placeName.split(/[^\p{L}\p{N}]+/u),
      ]);
    } else if (house && streetWord) {
      // AND of house# + street is correct for address_line match.
      searchQuery = `${house} ${streetWord}`;
    } else {
      searchQuery =
        streetWord || house || pickPrimarySearchTerm(terms) || qForLlm;
    }
  }

  // County / metro names are hubs, not city ILIKE filters (Irvine ≠ "Orange County").
  const rawCity = cityOverride ?? intent.city ?? normalized.city;
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

  // Named business / address paste: never lock category (wrong slug hides the venue).
  const categorySlug =
    categoryOverride ??
    (intent.queryMode === "business_name" || isAddressPaste
      ? null
      : intent.categorySlug);
  const searchParams = {
    categorySlug,
    city: cityForFilter,
    hubId,
    nearLat,
    nearLng,
  };

  let businesses = await safeSearchBusinesses(catalog, {
    ...searchParams,
    query: searchQuery,
  });

  // Address miss with city filter → retry street without city (city spelling mismatch).
  if (
    businesses.length === 0 &&
    isAddressPaste &&
    searchQuery &&
    cityForFilter
  ) {
    businesses = await safeSearchBusinesses(catalog, {
      hubId,
      nearLat,
      nearLng,
      query: searchQuery,
    });
  }

  // Name search miss → try raw corrected query across all categories.
  if (
    businesses.length === 0 &&
    intent.queryMode === "business_name" &&
    qForLlm &&
    qForLlm.toLowerCase() !== searchQuery.toLowerCase()
  ) {
    businesses = await safeSearchBusinesses(catalog, {
      city: isAddressPaste ? null : cityForFilter,
      hubId,
      nearLat,
      nearLng,
      query: qForLlm,
    });
  }

  // If text search was too strict, widen: primary token, then category browse.
  if (businesses.length === 0 && searchQuery) {
    const tokens = searchQuery.split(/\s+/).filter(Boolean);
    if (tokens.length > 1) {
      // For addresses prefer street name over bare house number.
      const primary = isAddressPaste
        ? [...tokens].sort((a, b) => {
            const aNum = /^\d+$/.test(a);
            const bNum = /^\d+$/.test(b);
            if (aNum !== bNum) return aNum ? 1 : -1;
            return b.length - a.length;
          })[0]
        : [...tokens].sort((a, b) => b.length - a.length)[0];
      businesses = await safeSearchBusinesses(catalog, {
        ...searchParams,
        city: isAddressPaste ? null : searchParams.city,
        query: primary,
      });
    }
  }

  if (
    businesses.length === 0 &&
    categorySlug &&
    intent.queryMode !== "business_name" &&
    !isAddressPaste
  ) {
    businesses = await safeSearchBusinesses(catalog, searchParams);
  }

  // Always pull hint-based matches (flooring on card) and merge on top of category browse.
  // One primary term only — bilingual lists must not AND together.
  const hintTerms = [
    ...intent.mustHints,
    ...(searchQuery ? [searchQuery] : []),
    ...corrections.map((c) => c.to),
    ...normalized.addressSearchTerms,
  ].filter(Boolean);
  if (hintTerms.length > 0) {
    const hintQuery = isAddressPaste
      ? searchQuery || pickPrimarySearchTerm(hintTerms)
      : pickPrimarySearchTerm(hintTerms);
    const extras = hintQuery
      ? await safeSearchBusinesses(catalog, {
          query: hintQuery,
          city: isAddressPaste ? null : cityForFilter,
          hubId,
          nearLat,
          nearLng,
        })
      : [];
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
          extra.addressLine,
          extra.city,
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
  // Never re-run the raw multi-token address (AND of USA/CA/zip kills recall).
  if (
    businesses.length === 0 &&
    qForLlm &&
    qForLlm !== searchQuery &&
    !isAddressPaste
  ) {
    businesses = await safeSearchBusinesses(catalog, {
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
    ...normalized.addressSearchTerms,
    ...intent.keywords.filter((k) =>
      ["русский", "russian", "украинский", "ukrainian"].includes(k.toLowerCase()),
    ),
  ];

  let ranked = rankBusinesses(businesses, softHints, near);

  // When we have trade/service hints and some cards match them, drop unrelated noise.
  // For address/identity pastes, keep anything that matched the structured query.
  if (softHints.length > 0 && !isAddressPaste && !isIdentityPaste) {
    const withScores = ranked.map((b) => ({ b, s: hintScore(b, softHints) }));
    const strong = withScores.filter((x) => x.s >= 3).map((x) => x.b);
    const any = withScores.filter((x) => x.s > 0).map((x) => x.b);
    if (strong.length > 0) ranked = strong;
    else if (any.length > 0) ranked = any;
  } else if (softHints.length > 0 && (isAddressPaste || isIdentityPaste)) {
    const withScores = ranked.map((b) => ({ b, s: hintScore(b, softHints) }));
    const any = withScores.filter((x) => x.s > 0).map((x) => x.b);
    if (any.length > 0) ranked = any;
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
    intent: fallback && !isAddressPaste
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
    fallback: fallback && !isAddressPaste,
    sortedByDistance: Boolean(near || intent.nearMe),
    preferCategory: intent.preferCategory,
    corrections: uniqueCorrections,
    correctedQuery:
      isAddressPaste && normalized.query !== normalized.original.slice(0, 200)
        ? normalized.query
        : uniqueCorrections.length > 0
          ? qForLlm
          : null,
  });
}
