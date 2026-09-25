import { createHmac, timingSafeEqual } from "node:crypto";

/** GitHub x-hub-signature-256. Returns false when the secret or header is missing. */
export function verifyGithubSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | null | undefined,
): boolean {
  const expectedSecret = secret?.trim() ?? "";
  const header = signatureHeader?.trim() ?? "";
  if (!expectedSecret || !header.startsWith("sha256=")) return false;
  const digest = createHmac("sha256", expectedSecret).update(rawBody).digest("hex");
  const provided = header.slice("sha256=".length);
  const a = Buffer.from(digest);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
