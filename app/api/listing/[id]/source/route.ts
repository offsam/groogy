import { NextResponse } from "next/server";
import {
  assertAiSearchRequestAllowed,
} from "@/lib/security/ai-search-guard";
import {
  clientIpFromRequest,
  consumeRateLimit,
} from "@/lib/security/rate-limit";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * Authenticated listing provenance reveal — original Telegram/Facebook post.
 */
export async function GET(request: Request, context: RouteContext) {
  const originGate = assertAiSearchRequestAllowed(request);
  if (!originGate.ok) {
    return NextResponse.json(
      { error: originGate.error },
      { status: originGate.status },
    );
  }

  const ip = clientIpFromRequest(request);
  const limited = await consumeRateLimit(`listing-source:${ip}`, {
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

  const sessionClient = await createServerClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const catalog = createServiceRoleClient();
    const { data, error } = await catalog
      .from("listings")
      .select("id, source_url, source_kind, status, visibility")
      .eq("id", id.trim())
      .maybeSingle();

    if (error) throw error;
    if (!data || data.status !== "active" || data.visibility !== "public") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const sourceUrl =
      data.source_kind === "platform"
        ? null
        : data.source_url?.trim() || null;

    try {
      await sessionClient.from("platform_events").insert({
        event_type: "contact_reveal",
        path: `/listing/${data.id}`,
        referrer: null,
        user_id: user.id,
        meta: {
          listing_id: data.id,
          surface: "listing_source",
          via: "listing_source_api",
        },
      });
    } catch {
      // never break reveal
    }

    return NextResponse.json({
      listingId: data.id,
      sourceUrl,
      sourceKind: data.source_kind,
    });
  } catch (err) {
    console.error("[listing/source]", err);
    return NextResponse.json({ error: "source_failed" }, { status: 500 });
  }
}
