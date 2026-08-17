import { NextResponse } from "next/server";
import {
  assertAiSearchRequestAllowed,
} from "@/lib/security/ai-search-guard";
import {
  clientIpFromRequest,
  consumeRateLimit,
} from "@/lib/security/rate-limit";
import { structureBusinessProfileCopy } from "@/lib/content/structure-business-profile";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getBusinessBySlug } from "@/lib/supabase/queries";
import {
  hasGoogleMapsPresence,
  resolveFacebookUrl,
  resolveGoogleMapsUrl,
  resolveInstagramUrl,
  resolveSourceUrl,
  resolveTelegramUrl,
  resolveTikTokUrl,
  resolveWebsiteUrl,
  resolveYelpUrl,
} from "@/lib/business/presence";

export const runtime = "nodejs";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

type RouteContext = {
  params: Promise<{ slug: string }>;
};

/**
 * Authenticated contact reveal — one business at a time.
 * Listing payloads never include these fields.
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
  const limited = consumeRateLimit(`business-contacts:${ip}`, {
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

    // Contacts may live only in free-text copy — surface them after auth.
    const extracted = structureBusinessProfileCopy(
      business.description,
      business.shortDescription,
    );

    const presence = {
      website: business.website || extracted.extractedWebsiteUrls[0] || null,
      instagramUrl:
        business.instagramUrl || extracted.extractedInstagramUrls[0] || null,
      telegramUrl: business.telegramUrl,
      sourceUrl: business.sourceUrl,
      sourceKind: business.sourceKind,
      facebookUrl: business.facebookUrl || extracted.extractedFacebookUrls[0] || null,
      tiktokUrl: business.tiktokUrl,
      yelpUrl: business.yelpUrl,
      googleMapsUrl: business.googleMapsUrl,
      contactLinks: business.contactLinks,
      latitude: business.latitude,
      longitude: business.longitude,
    };

    const googleHref = hasGoogleMapsPresence(presence)
      ? resolveGoogleMapsUrl(presence, business.name)
      : null;
    const coordsRoute =
      typeof business.latitude === "number" &&
      Number.isFinite(business.latitude) &&
      typeof business.longitude === "number" &&
      Number.isFinite(business.longitude)
        ? `https://www.google.com/maps/dir/?api=1&destination=${business.latitude},${business.longitude}`
        : null;
    const routeHref =
      coordsRoute ||
      (business.name.trim()
        ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(business.name.trim())}`
        : null);

    // Analytics (best-effort)
    try {
      await sessionClient.from("platform_events").insert({
        event_type: "contact_reveal",
        path: `/business/${business.slug}`,
        referrer: null,
        user_id: user.id,
        meta: {
          business_id: business.id,
          business_slug: business.slug,
          surface: "business",
          via: "contacts_api",
        },
      });
    } catch {
      // never break reveal
    }

    return NextResponse.json({
      businessId: business.id,
      slug: business.slug,
      name: business.name,
      phone: business.phone || extracted.extractedPhones[0] || null,
      email: business.email || extracted.extractedEmails[0] || null,
      extraPhones: extracted.extractedPhones.slice(
        business.phone ? 0 : 1,
        4,
      ),
      website: resolveWebsiteUrl(presence),
      instagramUrl: resolveInstagramUrl(presence),
      telegramUrl: resolveTelegramUrl(presence),
      sourceUrl: resolveSourceUrl(presence),
      sourceKind: business.sourceKind,
      facebookUrl: resolveFacebookUrl(presence),
      tiktokUrl: resolveTikTokUrl(presence),
      yelpUrl: resolveYelpUrl(presence),
      contactLinks: business.contactLinks,
      googleMapsUrl: googleHref,
      routeUrl:
        routeHref && routeHref !== googleHref ? routeHref : null,
      addressLine: business.addressLine,
      city: business.city,
      region: business.region,
      latitude: business.latitude,
      longitude: business.longitude,
    });
  } catch (err) {
    console.error("[business/contacts]", err);
    return NextResponse.json({ error: "contacts_failed" }, { status: 500 });
  }
}
