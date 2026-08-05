import { NextResponse } from "next/server";
import { assertAiSearchRequestAllowed } from "@/lib/security/ai-search-guard";
import {
  clientIpFromRequest,
  consumeRateLimit,
} from "@/lib/security/rate-limit";
import { createServerClient } from "@/lib/supabase/server";
import { parseContactLinks } from "@/lib/contacts/channels";

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
  const limited = consumeRateLimit(`church-contacts:${ip}`, {
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
            phone: string | null;
            email: string | null;
            website: string | null;
            instagram_url: string | null;
            telegram_url: string | null;
            google_maps_url: string | null;
            contact_links: unknown;
          }> | null;
          error: { message: string } | null;
        }>;
      }
    ).rpc("get_church_contacts", { p_slug: slug.trim() });

    if (error) {
      return NextResponse.json({ error: "contacts_failed" }, { status: 500 });
    }

    const row = data?.[0];
    if (!row) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({
      phone: row.phone,
      email: row.email,
      website: row.website,
      instagramUrl: row.instagram_url,
      telegramUrl: row.telegram_url ?? null,
      googleMapsUrl: row.google_maps_url ?? null,
      contactLinks: parseContactLinks(row.contact_links),
    });
  } catch {
    return NextResponse.json({ error: "contacts_failed" }, { status: 500 });
  }
}
