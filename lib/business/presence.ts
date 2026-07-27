/** Presence signals shown as compact badges on listing cards / profile. */

export type BusinessPresence = {
  website?: string | null;
  instagramUrl?: string | null;
  telegramUrl?: string | null;
  sourceUrl?: string | null;
  sourceKind?: "telegram" | "facebook" | "platform" | null;
  facebookUrl?: string | null;
  yelpUrl?: string | null;
  googleMapsUrl?: string | null;
  bookingUrl?: string | null;
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

export function isTelegramUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(normalizeHttpUrl(url)).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    return host === "t.me" || host === "telegram.me" || host.endsWith(".t.me");
  } catch {
    return /t\.me\/|telegram\.me\//i.test(url);
  }
}

/** Public website — never Instagram/Facebook/Yelp/Telegram social pages. */
export function resolveWebsiteUrl(presence: BusinessPresence): string | null {
  const website = presence.website?.trim() || null;
  if (!website) return null;
  if (
    isInstagramUrl(website) ||
    isFacebookUrl(website) ||
    isYelpUrl(website) ||
    isTelegramUrl(website)
  ) {
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

export function resolveTelegramUrl(presence: BusinessPresence): string | null {
  const direct = presence.telegramUrl?.trim() || null;
  if (!direct) return null;
  if (/^https?:\/\//i.test(direct)) return direct;
  if (/^tg:\/\//i.test(direct)) return direct;
  if (direct.startsWith("t.me/") || direct.startsWith("telegram.me/")) {
    return `https://${direct}`;
  }
  if (direct.startsWith("@")) {
    return `https://t.me/${direct.slice(1)}`;
  }
  // numeric Telegram user id — deep link (opens Telegram app)
  if (/^\d{5,15}$/.test(direct)) {
    return `tg://user?id=${direct}`;
  }
  // bare username
  if (/^[A-Za-z0-9_]{4,32}$/.test(direct)) {
    return `https://t.me/${direct}`;
  }
  return normalizeHttpUrl(direct);
}

/** Normalize form input to a storable telegram_url (or null). */
export function normalizeTelegramInput(
  value: string | null | undefined,
): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  return resolveTelegramUrl({ telegramUrl: raw });
}

export function telegramContactLabel(url: string): string {
  if (/^tg:\/\/user\?id=/i.test(url)) return "Telegram";
  if (/t\.me\/c\//i.test(url)) return "Оригинальный пост в Telegram";
  if (/t\.me\/\+/i.test(url)) return "Группа в Telegram";
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const handle = u.pathname.replace(/^\//, "").split("/")[0];
    if (handle && /^[A-Za-z0-9_]{4,32}$/.test(handle)) return `@${handle}`;
  } catch {
    // fall through
  }
  return "Telegram";
}

export function isPlatformSource(
  kind: BusinessPresence["sourceKind"] | null | undefined,
): boolean {
  return kind === "platform";
}

/** External post URL — never for platform-origin cards. */
export function resolveSourceUrl(presence: BusinessPresence): string | null {
  const direct = presence.sourceUrl?.trim() || null;
  if (!direct) return null;
  if (isPlatformSource(presence.sourceKind)) return null;
  return normalizeHttpUrl(direct);
}

/** True when we can show the «Источник» block (external post or КРУГИ). */
export function hasProvenanceSource(presence: {
  sourceUrl?: string | null;
  sourceKind?: BusinessPresence["sourceKind"];
}): boolean {
  if (isPlatformSource(presence.sourceKind)) return true;
  return Boolean(presence.sourceUrl?.trim());
}

export function sourceContactLabel(
  kind: BusinessPresence["sourceKind"],
  url: string,
): string {
  if (kind === "platform") return "КРУГИ";
  if (kind === "facebook" || isFacebookUrl(url)) {
    return "Оригинальный пост в Facebook";
  }
  if (kind === "telegram" || isTelegramUrl(url)) {
    return telegramContactLabel(url);
  }
  return "Источник";
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
