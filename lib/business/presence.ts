/** Presence signals shown as compact badges on listing cards / profile. */

import {
  contactHref,
  type ContactChannelId,
  type ContactLink,
} from "@/lib/contacts/channels";

/** Where a card came from. `null` = external but unclassified. */
export type SourceKind =
  | "telegram"
  | "facebook"
  | "directory"
  | "platform"
  | null;

export type BusinessPresence = {
  website?: string | null;
  instagramUrl?: string | null;
  telegramUrl?: string | null;
  sourceUrl?: string | null;
  sourceKind?: "telegram" | "facebook" | "platform" | "directory" | null;
  facebookUrl?: string | null;
  tiktokUrl?: string | null;
  yelpUrl?: string | null;
  googleMapsUrl?: string | null;
  bookingUrl?: string | null;
  googleRating?: number | null;
  googleReviewsCount?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Channels without a dedicated column (Facebook, TikTok, WhatsApp, …). */
  contactLinks?: ContactLink[] | null;
};

/** Value of an extra channel stored in `contact_links`. */
export function contactLinkValue(
  presence: BusinessPresence,
  channel: ContactChannelId,
): string | null {
  const found = presence.contactLinks?.find(
    (link) => link.channel === channel && link.value.trim(),
  );
  return found?.value.trim() || null;
}

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

export function isTikTokUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(normalizeHttpUrl(url)).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    return (
      host === "tiktok.com" ||
      host.endsWith(".tiktok.com") ||
      host === "vm.tiktok.com"
    );
  } catch {
    return /tiktok\.com/i.test(url);
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

/** Public website — never Instagram/Facebook/Yelp/Telegram/TikTok social pages. */
export function resolveWebsiteUrl(presence: BusinessPresence): string | null {
  const website = presence.website?.trim() || null;
  if (!website) return null;
  if (
    isInstagramUrl(website) ||
    isFacebookUrl(website) ||
    isYelpUrl(website) ||
    isTelegramUrl(website) ||
    isTikTokUrl(website)
  ) {
    return null;
  }
  return normalizeHttpUrl(website);
}

export function resolveFacebookUrl(presence: BusinessPresence): string | null {
  const direct = presence.facebookUrl?.trim() || null;
  if (direct) return normalizeHttpUrl(direct);
  const stored = contactLinkValue(presence, "facebook");
  if (stored) return contactHref("facebook", stored);
  const website = presence.website?.trim() || null;
  if (website && isFacebookUrl(website)) return normalizeHttpUrl(website);
  return null;
}

export function resolveTikTokUrl(presence: BusinessPresence): string | null {
  const direct = presence.tiktokUrl?.trim() || null;
  if (direct) return normalizeHttpUrl(direct);
  const stored = contactLinkValue(presence, "tiktok");
  if (stored) return contactHref("tiktok", stored);
  const website = presence.website?.trim() || null;
  if (website && isTikTokUrl(website)) return normalizeHttpUrl(website);
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

/** Known directory / yellow-pages hosts (Svoi, Orange Pages, …). */
export function isDirectorySourceUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  try {
    const host = new URL(normalizeHttpUrl(url)).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    return (
      host === "svoi.us" ||
      host.endsWith(".svoi.us") ||
      /(orange.?pages|yellow.?pages|to4ka|echoru|zerkalo|bazar\.club|russian-bazaar)/i.test(
        host,
      )
    );
  } catch {
    return /svoi\.us|orange.?pages|yellow.?pages|to4ka|echoru|zerkalo|bazar\.club|russian-bazaar/i.test(
      url,
    );
  }
}

function sourceHostLabel(url: string): string {
  try {
    const host = new URL(normalizeHttpUrl(url)).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    if (host === "svoi.us" || host.endsWith(".svoi.us")) return "Svoi";
    return host || "Справочник";
  } catch {
    return "Справочник";
  }
}

export function isPlatformSource(
  kind: BusinessPresence["sourceKind"] | null | undefined,
): boolean {
  return kind === "platform";
}

/**
 * «Created on КРУГИ» — the only case where we may claim the card as ours.
 * A stored external URL always wins over the kind: bad imports have written
 * `platform` on top of real directory links, and we must not repeat the claim.
 */
export function isPlatformOrigin(presence: {
  sourceUrl?: string | null;
  sourceKind?: BusinessPresence["sourceKind"];
}): boolean {
  if (presence.sourceUrl?.trim()) return false;
  return isPlatformSource(presence.sourceKind);
}

/** External post / directory URL, whatever the stored kind claims. */
export function resolveSourceUrl(presence: BusinessPresence): string | null {
  const direct = presence.sourceUrl?.trim() || null;
  if (!direct) return null;
  return normalizeHttpUrl(direct);
}

/** True when we can show the «Источник» block (external post or КРУГИ). */
export function hasProvenanceSource(presence: {
  sourceUrl?: string | null;
  sourceKind?: BusinessPresence["sourceKind"];
}): boolean {
  if (presence.sourceUrl?.trim()) return true;
  return isPlatformSource(presence.sourceKind);
}

/** Textual source hints that mean a directory / yellow-pages import. */
const DIRECTORY_SOURCE_HINT =
  /(directory|svoi|orange.?pages|yellow.?pages|to4ka|echoru|zerkalo|ruspages|slavic.?seattle|russian.?seattle|boston.?pages|our.?texas|bazar.?club|russian.?bazaar)/i;

/** Textual source hints that mean the card was really created on КРУГИ. */
const PLATFORM_SOURCE_HINT = /^(platform|krugi|user|owner|admin|manual)$/i;

/**
 * Single classifier for provenance on import / publish / section move.
 *
 * The URL wins over the textual hint — a card carrying an external link is
 * never ours. Returns `null` when the origin is genuinely unknown; callers
 * must store that null rather than falling back to `"platform"`, otherwise we
 * claim someone else's listing as our own.
 */
export function resolveSourceKind(
  sourceUrl: string | null | undefined,
  rawSource?: string | null,
): SourceKind {
  const url = sourceUrl?.trim() || null;
  const hint = rawSource?.trim().toLowerCase() || "";

  if (url) {
    if (isFacebookUrl(url)) return "facebook";
    if (isTelegramUrl(url)) return "telegram";
    if (isDirectorySourceUrl(url)) return "directory";
  }

  if (hint.startsWith("facebook")) return "facebook";
  if (hint.includes("telegram")) return "telegram";
  if (DIRECTORY_SOURCE_HINT.test(hint)) return "directory";

  // An unknown external link is still not ours — leave the kind unresolved and
  // let the UI label it by hostname.
  if (url) return null;
  if (PLATFORM_SOURCE_HINT.test(hint)) return "platform";
  return null;
}

/**
 * professionals / jobs keep provenance in an uppercase `source_type`.
 * `professionals_public` maps USER/ADMIN back to `platform` and derives
 * `directory` from the URL, so IMPORT is the right home for directory rows.
 */
export function sourceTypeFromKind(
  kind: SourceKind,
): "TELEGRAM" | "FACEBOOK" | "IMPORT" | "ADMIN" {
  if (kind === "telegram") return "TELEGRAM";
  if (kind === "facebook") return "FACEBOOK";
  if (kind === "platform") return "ADMIN";
  return "IMPORT";
}

/**
 * Label for an external source link. `platform` is deliberately not handled
 * here — a card with a URL is labelled by that URL, never as КРУГИ.
 */
export function sourceContactLabel(
  kind: BusinessPresence["sourceKind"],
  url: string,
): string {
  if (kind === "facebook" || isFacebookUrl(url)) {
    return "Оригинальный пост в Facebook";
  }
  if (kind === "telegram" || isTelegramUrl(url)) {
    return telegramContactLabel(url);
  }
  if (kind === "directory" || isDirectorySourceUrl(url)) {
    return `Справочник · ${sourceHostLabel(url)}`;
  }
  try {
    const host = new URL(normalizeHttpUrl(url)).hostname.replace(/^www\./, "");
    if (host) return host;
  } catch {
    // fall through
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
