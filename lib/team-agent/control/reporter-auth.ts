/** Timing-safe reporter token. A missing secret never counts as success. */
export function verifyReporterToken(
  authorization: string | null,
  expected: string | null | undefined,
): boolean {
  const provided = authorization?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const secret = expected?.trim() ?? "";
  if (!provided || !secret || provided.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}
