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
import { getBusinessBySlug } from "@/lib/supabase/queries";
import { resolveSourceUrl } from "@/lib/business/presence";

export const runtime = "nodejs";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

type RouteContext = {
  params: Promise<{ slug: string }>;
};

/**
 * Authenticated business provenance reveal — original Telegram/Facebook post.
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
  const limited = consumeRateLimit(`business-source:${ip}`, {
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

  const { slug } = await context.params;
  if (!slug?.trim()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const catalog = createServiceRoleClient();
    const business = await getBusinessBySlug(catalog, slug.trim());
    if (!business) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const sourceUrl = resolveSourceUrl({
      sourceUrl: business.sourceUrl,
      sourceKind: business.sourceKind,
    });

    try {
      await sessionClient.from("platform_events").insert({
        event_type: "contact_reveal",
        path: `/business/${business.slug}`,
        referrer: null,
        user_id: user.id,
        meta: {
          business_id: business.id,
          surface: "business_source",
          via: "business_source_api",
        },
      });
    } catch {
      // never break reveal
    }

    return NextResponse.json({
      businessId: business.id,
      sourceUrl,
      sourceKind: business.sourceKind,
    });
  } catch (err) {
    console.error("[business/source]", err);
    return NextResponse.json({ error: "source_failed" }, { status: 500 });
  }
}
