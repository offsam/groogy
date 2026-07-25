import "server-only";

const MAX_QUERY_CHARS = 200;
const MAX_BODY_BYTES = 4_096;

function allowedOrigins(): Set<string> {
  const origins = new Set<string>();
  origins.add("http://localhost:3000");
  origins.add("http://127.0.0.1:3000");

  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (site) origins.add(site);

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    origins.add(
      vercel.startsWith("http") ? vercel.replace(/\/$/, "") : `https://${vercel}`,
    );
  }

  const extra = process.env.AI_SEARCH_ALLOWED_ORIGINS?.trim();
  if (extra) {
    for (const part of extra.split(",")) {
      const o = part.trim().replace(/\/$/, "");
      if (o) origins.add(o);
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

/**
 * Reject cross-site abuse of /api/search/ai.
 * Allows same-origin browser calls; blocks bare curl without Origin/Referer in production.
 */
export function assertAiSearchRequestAllowed(
  request: Request,
): { ok: true } | { ok: false; status: number; error: string } {
  const allowed = allowedOrigins();
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
