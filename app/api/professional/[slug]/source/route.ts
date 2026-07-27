import { NextResponse } from "next/server";
import { assertAiSearchRequestAllowed } from "@/lib/security/ai-search-guard";
import {
  clientIpFromRequest,
  consumeRateLimit,
} from "@/lib/security/rate-limit";
import {
  deriveProfessionalSourceKind,
} from "@/lib/professional/mappers";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

type RouteContext = {
  params: Promise<{ slug: string }>;
};

/**
 * Authenticated professional provenance reveal — original Telegram/Facebook post.
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
  const limited = consumeRateLimit(`professional-source:${ip}`, {
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
    const { data, error } = await (
      catalog as unknown as {
        from: (table: string) => {
          select: (cols: string) => {
            eq: (
              col: string,
              val: string,
            ) => {
              maybeSingle: () => Promise<{
                data: {
                  id: string;
                  slug: string;
                  source_url: string | null;
                  source_type: string | null;
                  status: string;
                  visibility: string;
                } | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      }
    )
      .from("professionals")
      .select("id, slug, source_url, source_type, status, visibility")
      .eq("slug", slug.trim())
      .maybeSingle();

    if (error) throw error;
    if (!data || data.status !== "approved" || data.visibility !== "public") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const sourceKind = deriveProfessionalSourceKind(
      data.source_type,
      data.source_url,
    );
    const sourceUrl =
      sourceKind === "platform" ? null : data.source_url?.trim() || null;

    try {
      await sessionClient.from("platform_events").insert({
        event_type: "contact_reveal",
        path: `/professional/${data.slug}`,
        referrer: null,
        user_id: user.id,
        meta: {
          professional_id: data.id,
          surface: "professional_source",
          via: "professional_source_api",
        },
      });
    } catch {
      // never break reveal
    }

    return NextResponse.json({
      professionalId: data.id,
      sourceUrl,
      sourceKind,
    });
  } catch (err) {
    console.error("[professional/source]", err);
    return NextResponse.json({ error: "source_failed" }, { status: 500 });
  }
}
