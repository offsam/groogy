import { NextResponse } from "next/server";
import { assertAiSearchRequestAllowed } from "@/lib/security/ai-search-guard";
import {
  clientIpFromRequest,
  consumeRateLimit,
} from "@/lib/security/rate-limit";
import { deriveChurchSourceKind } from "@/lib/churches/mappers";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const originGate = assertAiSearchRequestAllowed(request);
  if (!originGate.ok) {
    return NextResponse.json(
      { error: originGate.error },
      { status: originGate.status },
    );
  }

  const ip = clientIpFromRequest(request);
  const limited = await consumeRateLimit(`church-source:${ip}`, {
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
    const { data, error } = await (
      sessionClient as unknown as {
        rpc: (
          name: string,
          args: { p_slug: string },
        ) => Promise<{
          data: Array<{
            source_url: string | null;
            source_kind: string | null;
          }> | null;
          error: { message: string } | null;
        }>;
      }
    ).rpc("get_church_source", { p_slug: slug.trim() });

    if (error) {
      return NextResponse.json({ error: "source_failed" }, { status: 500 });
    }

    const row = data?.[0];
    if (!row) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const sourceKind = deriveChurchSourceKind(row.source_kind, row.source_url);
    const sourceUrl =
      sourceKind === "platform" ? null : row.source_url?.trim() || null;

    return NextResponse.json({
      sourceUrl,
      sourceKind,
    });
  } catch {
    return NextResponse.json({ error: "source_failed" }, { status: 500 });
  }
}
