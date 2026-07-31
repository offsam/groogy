/**
 * Next.js dynamic `[slug]` params may arrive percent-encoded for non-ASCII
 * paths (e.g. Cyrillic). Catalog rows store Unicode NFC slugs — decode before
 * lookup so `/business/евгения-…` does not 404.
 */
export function normalizeRouteSlug(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return value;
  try {
    return decodeURIComponent(value).normalize("NFC");
  } catch {
    return value.normalize("NFC");
  }
}
