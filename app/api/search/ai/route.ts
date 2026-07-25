import { NextResponse } from "next/server";
import {
  OpenRouterError,
  parseSearchIntent,
  type SearchIntent,
} from "@/lib/ai/search-intent";
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
import type { Business } from "@/types/business";

export const runtime = "nodejs";

/** Tight limits so the shared OpenRouter key cannot be farmed as a general LLM. */
const AI_RATE_LIMIT = 12;
const AI_RATE_WINDOW_MS = 60_000;

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function rankByHints(businesses: Business[], hints: string[]): Business[] {
  if (hints.length === 0) return businesses;
  const normalized = hints.map((h) => h.toLowerCase());

  return [...businesses].sort((a, b) => {
    const score = (business: Business) => {
      const haystack = [
        business.name,
        business.shortDescription,
        business.description,
        business.categoryName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return normalized.reduce(
        (sum, hint) => sum + (haystack.includes(hint) ? 1 : 0),
        0,
      );
    };
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
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
    });
    return NextResponse.json({
      businesses,
      intent: emptyIntent(),
      modelUsed: null,
      fallback: false,
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

  const businesses = await searchBusinesses(client, {
    query: searchQuery,
    categorySlug: categoryOverride ?? intent.categorySlug,
    city: cityOverride ?? intent.city,
    hubId,
  });

  const ranked = fallback
    ? businesses
    : rankByHints(businesses, intent.mustHints);

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
  });
}
