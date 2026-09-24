/**
 * Webhook secret check (pure) — used by route + tests.
 */
export function verifyTelegramWebhookSecret(input: {
  expected: string | null | undefined;
  provided: string | null | undefined;
}): { ok: true } | { ok: false; reason: "missing" | "mismatch" } {
  const expected = input.expected?.trim() ?? "";
  if (!expected) return { ok: false, reason: "missing" };
  const provided = input.provided?.trim() ?? "";
  if (!provided || provided.length !== expected.length) {
    return { ok: false, reason: "mismatch" };
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0 ? { ok: true } : { ok: false, reason: "mismatch" };
}
