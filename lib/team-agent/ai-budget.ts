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

export const AI_BUDGET_WINDOW_MS = 10 * 60 * 1000;
export const AI_BUDGET_PER_MEMBER = 6;
export const AI_BUDGET_GLOBAL = 18;

type BudgetMessage = {
  id: string;
  member_id: string | null;
  reply_to_message_id: string | null;
  message_type: string;
  occurred_at: string;
  metadata: Record<string, unknown>;
};

/**
 * Counts saved AI replies. This survives a new serverless instance.
 * One person can fill only their own slot. The global cap is three people together.
 */
export function storedAiBudgetDecision(input: {
  messages: BudgetMessage[];
  memberId: string | null;
  now?: number;
  windowMs?: number;
}): { ok: true } | { ok: false; scope: "member" | "global"; retryAfterSec: number } {
  const now = input.now ?? Date.now();
  const windowMs = input.windowMs ?? AI_BUDGET_WINDOW_MS;
  const byId = new Map(input.messages.map((message) => [message.id, message]));
  const ai = input.messages.filter((message) => {
    if (message.message_type !== "bot" || !message.metadata.usage) return false;
    const age = now - new Date(message.occurred_at).getTime();
    return age >= 0 && age <= windowMs;
  });
  const oldest = ai.reduce<number | null>((min, message) => {
    const at = new Date(message.occurred_at).getTime();
    return min == null || at < min ? at : min;
  }, null);
  const retryAfterSec = oldest == null ? 60 : Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
  const mine = ai.filter((message) => {
    const parent = message.reply_to_message_id ? byId.get(message.reply_to_message_id) : null;
    return parent?.member_id === input.memberId;
  });
  if (input.memberId && mine.length >= AI_BUDGET_PER_MEMBER) {
    return { ok: false, scope: "member", retryAfterSec };
  }
  if (!input.memberId && mine.length >= 2) {
    return { ok: false, scope: "member", retryAfterSec };
  }
  if (ai.length >= AI_BUDGET_GLOBAL) {
    return { ok: false, scope: "global", retryAfterSec };
  }
  return { ok: true };
}
