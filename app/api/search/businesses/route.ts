import { NextResponse } from "next/server";
import {
  assertAiSearchRequestAllowed,
  clampSearchQuery,
} from "@/lib/security/ai-search-guard";
import {
  clientIpFromRequest,
  consumeRateLimit,
} from "@/lib/security/rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { searchBusinesses } from "@/lib/supabase/queries";

export const runtime = "nodejs";

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

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

async function handleSearch(input: {
  q: string | null;
  categorySlug: string | null;
  city: string | null;
  hubId: string | null;
  nearLat: number | null;
  nearLng: number | null;
}) {
  const client = createServiceRoleClient();
  const businesses = await searchBusinesses(client, {
    query: input.q ?? undefined,
    categorySlug: input.categorySlug,
    city: input.city,
    hubId: input.hubId ?? undefined,
    nearLat: input.nearLat,
    nearLng: input.nearLng,
  });
  return {
    businesses,
    sortedByDistance: Boolean(input.nearLat != null && input.nearLng != null),
  };
}

export async function GET(request: Request) {
  const originGate = assertAiSearchRequestAllowed(request);
  if (!originGate.ok) {
    return NextResponse.json(
      { error: originGate.error },
      { status: originGate.status },
    );
  }

  const ip = clientIpFromRequest(request);
  const limited = consumeRateLimit(`search-businesses:${ip}`, {
    limit: RATE_LIMIT,
    windowMs: RATE_WINDOW_MS,
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

  const url = new URL(request.url);
  const q = clampSearchQuery(asOptionalString(url.searchParams.get("q")) ?? "");
  const categorySlug = asOptionalString(url.searchParams.get("category"));
  const city = asOptionalString(url.searchParams.get("city"));
  const hubId = asOptionalString(url.searchParams.get("hub"));
  const nearLat = asOptionalCoord(url.searchParams.get("lat"), "lat");
  const nearLng = asOptionalCoord(url.searchParams.get("lng"), "lng");

  try {
    const result = await handleSearch({
      q: q || null,
      categorySlug,
      city,
      hubId,
      nearLat,
      nearLng,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[search/businesses]", err);
    return NextResponse.json({ error: "search_failed" }, { status: 500 });
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
  const limited = consumeRateLimit(`search-businesses:${ip}`, {
    limit: RATE_LIMIT,
    windowMs: RATE_WINDOW_MS,
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

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const q = clampSearchQuery(asOptionalString(body.q) ?? "");
  const categorySlug =
    asOptionalString(body.categorySlug) ?? asOptionalString(body.category);
  const city = asOptionalString(body.city);
  const hubId = asOptionalString(body.hubId) ?? asOptionalString(body.hub);
  const nearLat = asOptionalCoord(body.lat ?? body.nearLat, "lat");
  const nearLng = asOptionalCoord(body.lng ?? body.nearLng, "lng");

  try {
    const result = await handleSearch({
      q: q || null,
      categorySlug,
      city,
      hubId,
      nearLat,
      nearLng,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[search/businesses]", err);
    return NextResponse.json({ error: "search_failed" }, { status: 500 });
  }
}

/** Lightweight CORS preflight — same-origin browsers usually skip this. */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
