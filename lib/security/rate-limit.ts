import "server-only";
import { Redis } from "@upstash/redis";

type Bucket = {
  count: number;
  resetAt: number;
};

// In-memory fallback (per serverless instance, resets on cold start) —
// used when Redis isn't configured, and as a safety net if a Redis call
// ever fails so we fail open instead of blocking real traffic.
const buckets = new Map<string, Bucket>();

function consumeInMemory(
  key: string,
  options: { limit: number; windowMs: number },
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return { ok: true };
  }

  if (existing.count >= options.limit) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { ok: true };
}

// Support both the native Upstash env var names and the KV_REST_API_*
// names Vercel's Marketplace integration commonly injects, so this picks
// up the connection automatically however it was wired up.
const redisUrl =
  process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const redisToken =
  process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

const redis =
  redisUrl && redisToken
    ? new Redis({ url: redisUrl, token: redisToken })
    : null;

/**
 * Fixed-window rate limit. Shared across every serverless instance once
 * Upstash Redis is connected — without it, each cold-started instance had
 * its own counter, so a determined caller could just wait for a new
 * instance to reset the limit. Falls back to the old in-memory behavior
 * if Redis isn't configured yet, or fails open on a Redis error so an
 * outage there never blocks legitimate traffic.
 */
export async function consumeRateLimit(
  key: string,
  options: { limit: number; windowMs: number },
): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  if (!redis) return consumeInMemory(key, options);

  try {
    const redisKey = `ratelimit:${key}`;
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.pexpire(redisKey, options.windowMs);
    }
    if (count > options.limit) {
      const ttlMs = await redis.pttl(redisKey);
      return {
        ok: false,
        retryAfterSec: Math.max(
          1,
          Math.ceil((ttlMs > 0 ? ttlMs : options.windowMs) / 1000),
        ),
      };
    }
    return { ok: true };
  } catch {
    return consumeInMemory(key, options);
  }
}

/** Best-effort client IP from common proxy headers. */
export function clientIpFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}
