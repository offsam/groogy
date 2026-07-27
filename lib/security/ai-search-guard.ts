import "server-only";

const MAX_QUERY_CHARS = 200;
const MAX_BODY_BYTES = 4_096;

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function withWwwVariants(origin: string, into: Set<string>): void {
  into.add(origin);
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    if (host.startsWith("www.")) {
      u.hostname = host.slice(4);
    } else if (host.includes(".")) {
      u.hostname = `www.${host}`;
    }
    into.add(normalizeOrigin(u.origin));
  } catch {
    /* ignore */
  }
}

function allowedOrigins(): Set<string> {
  const origins = new Set<string>();
  withWwwVariants("http://localhost:3000", origins);
  withWwwVariants("http://127.0.0.1:3000", origins);

  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (site) withWwwVariants(site, origins);

  // Production brand domain (even if SITE_URL is misconfigured / apex-only).
  withWwwVariants("https://kroogy.com", origins);
  withWwwVariants("https://www.kroogy.com", origins);

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    const origin = vercel.startsWith("http")
      ? normalizeOrigin(vercel)
      : `https://${vercel.replace(/\/$/, "")}`;
    withWwwVariants(origin, origins);
  }

  const extra = process.env.AI_SEARCH_ALLOWED_ORIGINS?.trim();
  if (extra) {
    for (const part of extra.split(",")) {
      const o = part.trim().replace(/\/$/, "");
      if (o) withWwwVariants(o, origins);
    }
  }

  return origins;
}

function originOf(urlOrOrigin: string | null): string | null {
  if (!urlOrOrigin) return null;
  try {
    return new URL(urlOrOrigin).origin;
  } catch {
    return null;
  }
}

/** Origin of the current deployment host (covers www vs apex + preview URLs). */
function requestHostOrigin(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwarded || request.headers.get("host")?.trim();
  if (!host) return null;
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}

/**
 * Reject cross-site abuse of /api/search/*.
 * Allows same-origin browser calls; blocks bare curl without Origin/Referer in production.
 */
export function assertAiSearchRequestAllowed(
  request: Request,
): { ok: true } | { ok: false; status: number; error: string } {
  const allowed = allowedOrigins();
  const self = requestHostOrigin(request);
  if (self) withWwwVariants(self, allowed);

  const origin = originOf(request.headers.get("origin"));
  const referer = originOf(request.headers.get("referer"));
  const candidate = origin ?? referer;

  if (candidate && allowed.has(candidate)) {
    return { ok: true };
  }

  // Local / preview: allow missing Origin (server-side tests).
  if (process.env.NODE_ENV !== "production") {
    return { ok: true };
  }

  // Production: require Origin or Referer from allowlist.
  if (!candidate) {
    return { ok: false, status: 403, error: "forbidden_origin" };
  }

  return { ok: false, status: 403, error: "forbidden_origin" };
}

export function clampSearchQuery(q: string): string {
  return q.trim().slice(0, MAX_QUERY_CHARS);
}

export async function readAiSearchJsonBody(
  request: Request,
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; error: string }
> {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: "payload_too_large" };
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: "payload_too_large" };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, status: 400, error: "invalid_json" };
    }
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, status: 400, error: "invalid_json" };
  }
}

export { MAX_QUERY_CHARS };
