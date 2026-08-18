/** Category SVGs and generic placeholders are not real business photos. */
export function isPlaceholderBusinessImage(url: string | null | undefined): boolean {
  if (!url) return true;
  return (
    url.includes("/images/categories/") ||
    url.endsWith("placeholder.svg") ||
    url.endsWith("/placeholder.svg")
  );
}

export function hasRealBusinessPhoto(url: string | null | undefined): boolean {
  return !isPlaceholderBusinessImage(url);
}

/** Extra profile photos (certificates, interior) stored on the entity row. */
export const GALLERY_URLS_COLUMN_READY = true;

export function parseGalleryUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const url = String(item || "").trim();
    if (!url.startsWith("http") || out.includes(url)) continue;
    if (!hasRealBusinessPhoto(url)) continue;
    out.push(url);
    if (out.length >= 12) break;
  }
  return out;
}
