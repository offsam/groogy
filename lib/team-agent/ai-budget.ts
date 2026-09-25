/**
 * Per-process cap on paid Team Agent calls.
 * Passive chat never reaches this. A burst of mentions cannot drain the balance.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function consumeAiBudget(
  key = "team-agent-ai",
  options: { limit: number; windowMs: number } = { limit: 8, windowMs: 10 * 60 * 1000 },
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

export function resetAiBudgetForTests(): void {
  buckets.clear();
}
