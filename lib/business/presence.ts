/** Presence signals shown as compact badges on listing cards / profile. */

export type BusinessPresence = {
  website?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  yelpUrl?: string | null;
  googleMapsUrl?: string | null;
  googleRating?: number | null;
  googleReviewsCount?: number | null;
  latitude?: number | null;
  longitude?: number | null;
};

function normalizeHttpUrl(url: string): string {
  return url.startsWith("http") ? url : `https://${url}`;
}

export function isInstagramUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(normalizeHttpUrl(url)).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    return host === "instagram.com" || host.endsWith(".instagram.com");
  } catch {
    return /instagram\.com/i.test(url);
  }
}

export function isFacebookUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(normalizeHttpUrl(url)).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    return (
      host === "facebook.com" ||
      host.endsWith(".facebook.com") ||
      host === "fb.com" ||
      host.endsWith(".fb.com")
    );
  } catch {
    return /facebook\.com|fb\.com/i.test(url);
  }
}

export function isYelpUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(normalizeHttpUrl(url)).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    return host === "yelp.com" || host.endsWith(".yelp.com");
  } catch {
    return /yelp\.com/i.test(url);
  }
}

/** Instagram only — never treat a website field as Instagram here for dual display. */
export function resolveInstagramUrl(presence: BusinessPresence): string | null {
  const direct = presence.instagramUrl?.trim() || null;
  if (direct) return normalizeHttpUrl(direct);
  // Legacy: some imports put Instagram into website
  const website = presence.website?.trim() || null;
  if (website && isInstagramUrl(website)) return normalizeHttpUrl(website);
  return null;
}

/** Public website — never Instagram/Facebook/Yelp social pages. */
export function resolveWebsiteUrl(presence: BusinessPresence): string | null {
  const website = presence.website?.trim() || null;
  if (!website) return null;
  if (isInstagramUrl(website) || isFacebookUrl(website) || isYelpUrl(website)) {
    return null;
  }
  return normalizeHttpUrl(website);
}

export function resolveFacebookUrl(presence: BusinessPresence): string | null {
  const direct = presence.facebookUrl?.trim() || null;
  if (direct) return normalizeHttpUrl(direct);
  const website = presence.website?.trim() || null;
  if (website && isFacebookUrl(website)) return normalizeHttpUrl(website);
  return null;
}

export function resolveYelpUrl(presence: BusinessPresence): string | null {
  const direct = presence.yelpUrl?.trim() || null;
  if (direct) return normalizeHttpUrl(direct);
  const website = presence.website?.trim() || null;
  if (website && isYelpUrl(website)) return normalizeHttpUrl(website);
  return null;
}

export function resolveGoogleMapsUrl(
  presence: BusinessPresence,
  _fallbackName?: string,
): string | null {
  const direct = presence.googleMapsUrl?.trim() || null;
  if (direct) return direct;
  if (
    typeof presence.latitude === "number" &&
    Number.isFinite(presence.latitude) &&
    typeof presence.longitude === "number" &&
    Number.isFinite(presence.longitude)
  ) {
    return `https://www.google.com/maps/?q=${presence.latitude},${presence.longitude}`;
  }
  return null;
}

export function hasGoogleMapsPresence(presence: BusinessPresence): boolean {
  if (presence.googleMapsUrl?.trim()) return true;
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
