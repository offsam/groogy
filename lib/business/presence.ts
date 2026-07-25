/** Presence signals shown as compact badges on listing cards. */

export type BusinessPresence = {
  website?: string | null;
  instagramUrl?: string | null;
  googleMapsUrl?: string | null;
  googleRating?: number | null;
  googleReviewsCount?: number | null;
  latitude?: number | null;
  longitude?: number | null;
};

export function isInstagramUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    return host === "instagram.com" || host.endsWith(".instagram.com");
  } catch {
    return /instagram\.com/i.test(url);
  }
}

export function resolveInstagramUrl(presence: BusinessPresence): string | null {
  const direct = presence.instagramUrl?.trim() || null;
  if (direct) return direct;
  const website = presence.website?.trim() || null;
  if (website && isInstagramUrl(website)) return website;
  return null;
}

export function hasGoogleMapsPresence(presence: BusinessPresence): boolean {
  if (presence.googleMapsUrl?.trim()) return true;
  if (
    presence.googleRating != null &&
    Number.isFinite(Number(presence.googleRating))
  ) {
    return true;
  }
  return (
    typeof presence.latitude === "number" &&
    Number.isFinite(presence.latitude) &&
    typeof presence.longitude === "number" &&
    Number.isFinite(presence.longitude)
  );
}

export function normalizeGoogleRating(
  value: number | null | undefined,
): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 5) return null;
  return Math.round(n * 10) / 10;
}
