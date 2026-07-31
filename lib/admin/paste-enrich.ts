/**
 * Admin paste-enrich: extract contacts/location/description from free text.
 * Fill-empty only — mirrors Python step_source_text (no LLM).
 */

import type { OpeningHours, OpeningHoursDay } from "@/lib/business/opening-hours";
import { dayLabelRu } from "@/lib/business/opening-hours";

export type PasteEnrichExisting = {
  /** Company name — only the import queue fills this. */
  name?: string | null;
  phone?: string | string[] | null;
  email?: string | string[] | null;
  website?: string | string[] | null;
  /** Handle, URL, or list — normalized for emptiness check. */
  instagram?: string | string[] | null;
  telegram?: string | null;
  facebook?: string | null;
  whatsapp?: string | string[] | null;
  googleMaps?: string | null;
  city?: string | null;
  state?: string | null;
  addressLine?: string | null;
  postalCode?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  openingHours?: OpeningHours | null;
};

export type PasteEnrichExtracted = {
  /** Null unless the caller asked for name inference (import queue only). */
  name: string | null;
  phone: string[];
  email: string[];
  website: string[];
  instagram: string[];
  telegram: string | null;
  facebook: string | null;
  whatsapp: string | null;
  googleMaps: string | null;
  city: string | null;
  state: string | null;
  addressLine: string | null;
  postalCode: string | null;
  description: string | null;
  openingHours: OpeningHours | null;
};

export type PasteEnrichFieldKey =
  | "name"
  | "phone"
  | "email"
  | "website"
  | "instagram"
  | "telegram"
  | "facebook"
  | "whatsapp"
  | "googleMaps"
  | "city"
  | "state"
  | "address"
  | "postal"
  | "description"
  | "openingHours"
  | "image";

export type PasteEnrichPreviewItem = {
  key: PasteEnrichFieldKey;
  label: string;
  value: string;
  action: "add" | "skip";
};

const PHONE_RE = /(?:\+?\d[\d\-\s().]{8,}\d)/g;
/** Scrubbing variant — also eats the wrapping paren «Тел: (714) …». */
const PHONE_SPAN_RE = /\(?\+?\d[\d\-\s().]{8,}\d/g;
/**
 * «Тел:» / «Phone:» left behind once the number itself is gone.
 * No \b — it is ASCII-only in JS and would never fire before «Телефон».
 */
const PHONE_LABEL_RE =
  /(?<![A-Za-zА-Яа-яЁё])(?:тел(?:ефон)?|phone|call|моб(?:ильный)?)\s*[:：]?\s*(?=[\s,;]|$)/gi;
const URL_SPAN_RE = /https?:\/\/[^\s<>"']+|www\.[^\s<>"']+/gi;
const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
const INSTAGRAM_URL_RE =
  /(?:instagram\.com\/|instagr\.am\/)([A-Za-z0-9._]{2,30})/gi;
const INSTAGRAM_LABELED_RE =
  /(?:instagram|инста(?:грам)?)\s*[:：]\s*@?([A-Za-z0-9._]{2,30})\b/gi;
const INSTAGRAM_HANDLE_RE =
  /(?:^|[\s(,])@([A-Za-z0-9._]{3,30})(?=[\s,).!]|$)/g;
const WEBSITE_RE = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
/** Bare hosts with optional path (glossgenius.com/x, framer.website). */
const BARE_WEBSITE_RE =
  /(?<![A-Za-z0-9@/])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|co|app|me|link|cc|website|studio|shop|store|online|site)(?:\/[^\s<>"']*)?)/gi;
const TELEGRAM_URL_RE =
  /(?:t\.me\/|telegram\.me\/|tg:\/\/resolve\?domain=)([A-Za-z0-9_]{4,32})/gi;
const TELEGRAM_LABELED_RE =
  /(?:telegram|телеграм(?:м)?)\s*[:：]\s*@?([A-Za-z0-9_]{4,32})\b/gi;
const TELEGRAM_ID_SPAN_RE =
  /(?:telegram\s*id|tg\s*id|user\s*id)\s*[:：]?\s*\d{6,15}/gi;

const INSTAGRAM_STOP = new Set([
  "gmail",
  "yahoo",
  "mail",
  "email",
  "http",
  "https",
  "www",
  "com",
  "org",
  "net",
  "messenger",
  "whatsapp",
  "telegram",
  "facebook",
  "outlook",
  "hotmail",
]);

const TELEGRAM_PATH_STOP = new Set([
  "share",
  "joinchat",
  "addstickers",
  "proxy",
  "socks",
  "iv",
]);

const SOCIAL_HOST_MARKERS = [
  "instagram.com",
  "instagr.am",
  "facebook.com",
  "fb.com",
  "fb.me",
  "t.me/",
  "telegram.me",
  "wa.me/",
  "whatsapp.com",
  "wtsp.cc",
  "maps.app.goo.gl",
  "goo.gl/maps",
  "maps.google.",
  "google.com/maps",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
];

/** Incomplete short-host matches from BARE_WEBSITE_RE (maps.app ⊂ maps.app.goo.gl). */
const WEBSITE_HOST_BLOCKLIST = new Set([
  "maps.app",
  "wtsp.cc",
  "wa.me",
  "facebook.com",
  "fb.com",
  "fb.me",
  "instagram.com",
  "instagr.am",
  "t.me",
  "telegram.me",
]);

const FACEBOOK_URL_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:facebook\.com|fb\.com|fb\.me)\/[A-Za-z0-9._\-/]+/gi;
const WHATSAPP_URL_RE =
  /(?:https?:\/\/)?(?:(?:wa\.me|api\.whatsapp\.com)\/[^\s<>"']+|wtsp\.cc\/\d{7,15})/gi;
const GOOGLE_MAPS_URL_RE =
  /(?:https?:\/\/)?(?:maps\.app\.goo\.gl\/[A-Za-z0-9_-]+(?:\?[^\s<>"']*)?|goo\.gl\/maps\/[A-Za-z0-9_-]+|(?:www\.)?(?:google\.com\/maps|maps\.google\.[a-z.]+)[^\s<>"']*)/gi;

const WEAK_DESCRIPTION_RE =
  /fast\.?\s*secure\.?\s*powerful|instagram\.com|instagr\.am|t\.me\/|telegram\.org/i;

/** Specific cities first — county metros last (so Newport Beach wins over OC). */
const PLACE_RULES: { re: RegExp; city: string | null; state: string }[] = [
  { re: /\bnewport\s*beach\b/i, city: "Newport Beach", state: "CA" },
  { re: /\birvine\b/i, city: "Irvine", state: "CA" },
  { re: /\bcosta\s*mesa\b/i, city: "Costa Mesa", state: "CA" },
  { re: /\banaheim\b/i, city: "Anaheim", state: "CA" },
  { re: /\blos\s*angeles\b/i, city: "Los Angeles", state: "CA" },
  { re: /\bsacramento\b|сакраменто/i, city: "Sacramento", state: "CA" },
  { re: /\bsan\s*diego\b/i, city: "San Diego", state: "CA" },
  { re: /\bsan\s*francisco\b/i, city: "San Francisco", state: "CA" },
  { re: /\bseattle\b|сиэтл|сиетл/i, city: "Seattle", state: "WA" },
  { re: /\bportland\b/i, city: "Portland", state: "OR" },
  { re: /\bmiami\b/i, city: "Miami", state: "FL" },
  { re: /\bnew\s*york\b|\bnyc\b/i, city: "New York", state: "NY" },
  { re: /\borange\s*county\b|\boc\b/i, city: "Orange County", state: "CA" },
];

/** US street + city + state, ZIP optional (e.g. «18062 Irvine Blvd, Tustin, CA»). */
const US_STREET_ADDRESS_RE =
  /((?<![\d\-])\d{1,6}[ \t]+[A-Za-z0-9.'\-]+(?:[ \t]+[A-Za-z0-9.'\-]+){0,6}[ \t]+(?:Ave|Avenue|St|Street|Blvd|Boulevard|Rd|Road|Dr|Drive|Way|Ln|Lane|Ct|Court|Pl|Place|Hwy|Highway)\.?)\s*,\s*([A-Za-z][A-Za-z.\s]+?)\s*,\s*(?:([A-Z]{2})|California|CA|Washington|WA|New\s*York|NY|Florida|FL|Oregon|OR|Texas|TX)(?:\s+(\d{5})(?:-\d{4})?)?/i;

const IG_STATS_LINE_RE =
  /^\s*\d[\d\s,.]*\s*(?:публикаци[йяе]|подписчик(?:ов)?|подписок|followers?|following|posts?).*$/gim;

const FIELD_LABELS: Record<PasteEnrichFieldKey, string> = {
  name: "Название",
  phone: "Телефон",
  email: "Email",
  website: "Сайт",
  instagram: "Instagram",
  telegram: "Telegram",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  googleMaps: "Google Maps",
  city: "Город",
  state: "Штат",
  address: "Адрес",
  postal: "ZIP",
  description: "Описание",
  openingHours: "Часы работы",
  image: "Фото",
};

const DAY_NAME_TO_JS: Record<string, OpeningHoursDay["day"]> = {
  sunday: 0,
  sun: 0,
  воскресенье: 0,
  вс: 0,
  monday: 1,
  mon: 1,
  понедельник: 1,
  пн: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  вторник: 2,
  вт: 2,
  wednesday: 3,
  wed: 3,
  среда: 3,
  ср: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  четверг: 4,
  чт: 4,
  friday: 5,
  fri: 5,
  пятница: 5,
  пт: 5,
  saturday: 6,
  sat: 6,
  суббота: 6,
  сб: 6,
};

/** Google Maps / Apple Maps UI dump — not a real «О нас». */
const MAPS_CHROME_RE =
  /\b(?:directions|overview|reviews|about|nearby|send to phone|suggest new hours|open now|save|share|services)\b/gi;

function mapsChromeHitCount(text: string): number {
  return [...text.matchAll(MAPS_CHROME_RE)].length;
}

function emptyOpeningHours(
  value: OpeningHours | null | undefined,
): boolean {
  if (!value || !Array.isArray(value.weekly) || value.weekly.length === 0) {
    return true;
  }
  return !value.weekly.some(
    (d) => !d.closed && Boolean(d.open?.trim()) && Boolean(d.close?.trim()),
  );
}

function to24h(hourRaw: string, minuteRaw: string | undefined, ampm: string): string | null {
  let hour = Number(hourRaw);
  const minute = minuteRaw ? Number(minuteRaw) : 0;
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  const ap = ampm.toLowerCase();
  if (ap === "pm" && hour < 12) hour += 12;
  if (ap === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const CLOCK_RE =
  /(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)/;

const HOURS_RANGE_RE =
  /(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)\s*[–—−-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)/i;

const DAY_LINE_RE =
  /^(sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|воскресенье|вс|понедельник|пн|вторник|вт|среда|ср|четверг|чт|пятница|пт|суббота|сб)\b/i;

function parseHoursRange(
  raw: string,
): { open: string; close: string } | null {
  const m = HOURS_RANGE_RE.exec(raw);
  if (!m) return null;
  const open = to24h(m[1]!, m[2], m[3]!);
  const close = to24h(m[4]!, m[5], m[6]!);
  if (!open || !close) return null;
  return { open, close };
}

/**
 * Google Maps “Hours” block (day on one line, range on the next) or
 * «Friday 10 AM–6 PM» on one line.
 */
export function extractOpeningHoursFromText(
  text: string,
): OpeningHours | null {
  const normalized = demathAlnum(text || "")
    .replace(/[\u202f\u00a0\u2007\u2060]/g, " ")
    .replace(/\r\n?/g, "\n");
  if (!CLOCK_RE.test(normalized) && !/\bclosed\b/i.test(normalized)) {
    return null;
  }

  const weekly = new Map<OpeningHoursDay["day"], OpeningHoursDay>();
  const lines = normalized
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const dayMatch = DAY_LINE_RE.exec(line);
    if (!dayMatch) continue;
    const dayKey = dayMatch[1]!.toLowerCase();
    const day = DAY_NAME_TO_JS[dayKey];
    if (day == null) continue;

    const rest = line.slice(dayMatch[0].length).trim();
    const next = lines[i + 1] || "";
    const closed =
      /\bclosed\b/i.test(rest) ||
      /\bзакрыт/i.test(rest) ||
      (!HOURS_RANGE_RE.test(rest) &&
        (/\bclosed\b/i.test(next) || /\bзакрыт/i.test(next)));

    if (closed) {
      weekly.set(day, { day, closed: true });
      continue;
    }

    const range =
      parseHoursRange(rest) ||
      (!DAY_LINE_RE.test(next) ? parseHoursRange(next) : null);
    if (!range) continue;
    weekly.set(day, {
      day,
      closed: false,
      open: range.open,
      close: range.close,
    });
  }

  // Same-line fallbacks scattered in a paragraph (rare).
  if (weekly.size === 0) {
    const re =
      /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b[^.\n]{0,40}?(\d{1,2}(?::\d{2})?\s*(?:AM|PM)\s*[–—−-]\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM)|closed)/gi;
    for (const match of normalized.matchAll(re)) {
      const day = DAY_NAME_TO_JS[match[1]!.toLowerCase()];
      if (day == null || weekly.has(day)) continue;
      if (/\bclosed\b/i.test(match[2] || "")) {
        weekly.set(day, { day, closed: true });
        continue;
      }
      const range = parseHoursRange(match[2] || "");
      if (!range) continue;
      weekly.set(day, {
        day,
        closed: false,
        open: range.open,
        close: range.close,
      });
    }
  }

  const openDays = [...weekly.values()].filter(
    (d) => !d.closed && d.open && d.close,
  );
  if (openDays.length < 1) return null;

  const full: OpeningHoursDay[] = ([0, 1, 2, 3, 4, 5, 6] as const).map(
    (day) => weekly.get(day) ?? { day, closed: true },
  );
  return { timezone: "America/Los_Angeles", weekly: full };
}

export function formatOpeningHoursPreview(hours: OpeningHours): string {
  const open = hours.weekly.filter((d) => !d.closed && d.open && d.close);
  if (open.length === 0) return "закрыто";
  const first = open[0]!;
  const allSame =
    open.length >= 5 &&
    open.every((d) => d.open === first.open && d.close === first.close);
  if (allSame && open.length === 7) {
    return `ежедневно ${first.open}–${first.close}`;
  }
  if (allSame) {
    return `${open.map((d) => dayLabelRu(d.day).slice(0, 2)).join(", ")} ${first.open}–${first.close}`;
  }
  return open
    .map((d) => `${dayLabelRu(d.day).slice(0, 2)} ${d.open}–${d.close}`)
    .join("; ");
}

function emptyScalar(value: string | null | undefined): boolean {
  return !(value || "").trim();
}

function emptyList(value: string | string[] | null | undefined): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) return value.filter((x) => (x || "").trim()).length === 0;
  return !(value || "").trim();
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.trim().startsWith("+")) return `+${digits}`;
  return digits.length >= 10 ? `+${digits}` : null;
}

function normalizeUrl(url: string): string {
  let u = (url || "").trim().replace(/[.,);\]"']+$/g, "");
  if (!u) return u;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

function isSocialUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (SOCIAL_HOST_MARKERS.some((m) => lower.includes(m))) return true;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (WEBSITE_HOST_BLOCKLIST.has(host)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

function maskUrls(text: string): string {
  return text.replace(URL_SPAN_RE, (m) => " ".repeat(m.length));
}

/** UUID / truncated UUID fragments look like phones (3037-4158 → +14303741588). */
const UUID_SPAN_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}(?:-[0-9a-f]{0,12})?\b/gi;

function maskUuidSpans(text: string): string {
  return text.replace(UUID_SPAN_RE, (m) => " ".repeat(m.length));
}

function maskTelegramIds(text: string): string {
  return text.replace(TELEGRAM_ID_SPAN_RE, (m) => " ".repeat(m.length));
}

export function extractFacebookFromText(text: string): string | null {
  for (const match of (text || "").matchAll(FACEBOOK_URL_RE)) {
    const url = normalizeUrl(match[0] || "");
    if (!url) continue;
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      if (!["facebook.com", "fb.com", "fb.me"].includes(host)) continue;
      const path = u.pathname.replace(/\/+$/, "");
      if (!path || path === "/") continue;
      return `https://www.facebook.com${path}`;
    } catch {
      continue;
    }
  }
  return null;
}

export function extractWhatsAppFromText(text: string): string | null {
  for (const match of (text || "").matchAll(WHATSAPP_URL_RE)) {
    const raw = (match[0] || "").trim();
    if (!raw) continue;
    const digits = raw.replace(/\D/g, "");
    if (/wtsp\.cc/i.test(raw) && digits.length >= 10) {
      return `https://wa.me/${digits}`;
    }
    const url = normalizeUrl(raw);
    if (!url) continue;
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      if (host === "wa.me") {
        const pathDigits = u.pathname.replace(/\D/g, "");
        if (pathDigits.length >= 10) return `https://wa.me/${pathDigits}`;
      }
      if (host.includes("whatsapp.com")) return url;
    } catch {
      continue;
    }
  }
  // Labeled block: WHATSAPP\n+1 949…
  const labeled = (text || "").match(
    /whatsapp\s*[:：]?\s*(?:\n|\s)*(\+?\d[\d\-\s().]{8,}\d)/i,
  );
  if (labeled?.[1]) {
    const phone = normalizePhone(labeled[1]);
    if (phone) return `https://wa.me/${phone.replace(/\D/g, "")}`;
  }
  return null;
}

export function extractGoogleMapsFromText(text: string): string | null {
  for (const match of (text || "").matchAll(GOOGLE_MAPS_URL_RE)) {
    const url = normalizeUrl(match[0] || "");
    if (!url) continue;
    // Reject truncated maps.app without goo.gl
    if (/^https?:\/\/maps\.app\/?$/i.test(url.replace(/\/$/, ""))) continue;
    return url;
  }
  return null;
}

export function extractPhonesFromText(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const scrubbed = maskTelegramIds(maskUuidSpans(maskUrls(text || "")));
  for (const match of scrubbed.matchAll(PHONE_RE)) {
    const phone = normalizePhone(match[0] || "");
    if (phone && !seen.has(phone)) {
      seen.add(phone);
      found.push(phone);
    }
  }
  return found;
}

export function extractEmailsFromText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of (text || "").matchAll(EMAIL_RE)) {
    const e = (match[0] || "").toLowerCase();
    if (!seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  return out;
}

export function extractTelegramFromText(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (handle: string) => {
    const h = handle.trim().replace(/^@/, "").toLowerCase();
    if (!h || TELEGRAM_PATH_STOP.has(h) || /^\d+$/.test(h)) return;
    if (!seen.has(h)) {
      seen.add(h);
      found.push(h);
    }
  };
  for (const match of (text || "").matchAll(TELEGRAM_URL_RE)) {
    if (match[1]) add(match[1]);
  }
  for (const match of (text || "").matchAll(TELEGRAM_LABELED_RE)) {
    if (match[1]) add(match[1]);
  }
  return found;
}

export function extractInstagramFromText(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const telegramHandles = new Set(extractTelegramFromText(text));
  const add = (handle: string) => {
    const h = handle.replace(/\.$/, "").toLowerCase();
    if (!h || INSTAGRAM_STOP.has(h) || /^\d+$/.test(h)) return;
    if (/\.(com|net|org|ru|io)$/i.test(h)) return;
    if (telegramHandles.has(h)) return;
    if (!seen.has(h)) {
      seen.add(h);
      found.push(h);
    }
  };

  for (const match of (text || "").matchAll(INSTAGRAM_URL_RE)) {
    if (match[1]) add(match[1]);
  }
  for (const match of (text || "").matchAll(INSTAGRAM_LABELED_RE)) {
    if (match[1]) add(match[1]);
  }
  for (const match of (text || "").matchAll(INSTAGRAM_HANDLE_RE)) {
    if (!match[1]) continue;
    const start = match.index ?? 0;
    const window = (text || "").slice(Math.max(0, start - 40), start).toLowerCase();
    if (/(?:telegram|телеграм(?:м)?)\s*[:：]?\s*@?$/.test(window)) continue;
    if (telegramHandles.has(match[1].toLowerCase())) continue;
    add(match[1]);
  }
  return found;
}

export function extractWebsitesFromText(text: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    const url = normalizeUrl(raw);
    if (!url || isSocialUrl(url)) return;
    let host = "";
    try {
      host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return;
    }
    // Skip email-like false positives
    if (!host.includes(".")) return;
    if (WEBSITE_HOST_BLOCKLIST.has(host)) return;
    const key = url.toLowerCase().replace(/\/$/, "");
    if (seen.has(key) || seen.has(host)) return;
    seen.add(key);
    seen.add(host);
    urls.push(url.replace(/\/$/, "") === `https://${host}` ? `https://${host}` : url);
  };

  for (const match of (text || "").matchAll(WEBSITE_RE)) {
    add(match[0] || "");
  }
  for (const match of (text || "").matchAll(BARE_WEBSITE_RE)) {
    add(match[1] || match[0] || "");
  }
  return urls;
}

/** True if description is empty, placeholder, or mostly links (safe to overwrite). */
export function isWeakDescription(value: string | null | undefined): boolean {
  const t = (value || "").trim();
  if (!t) return true;
  if (WEAK_DESCRIPTION_RE.test(t)) return true;
  const stripped = t
    .replace(URL_SPAN_RE, " ")
    .replace(BARE_WEBSITE_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length < 24 && t.length >= 24) return true;
  return false;
}

/** Remove URLs from a weak description; null if nothing useful remains (clear field). */
export function scrubWeakDescription(
  value: string | null | undefined,
): string | null {
  const t = (value || "").trim();
  if (!t) return null;
  const cleaned = t
    .replace(URL_SPAN_RE, " ")
    .replace(BARE_WEBSITE_RE, " ")
    .replace(/(?:instagram\.com\/|instagr\.am\/)[A-Za-z0-9._/]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 20) return null;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 4) return null;
  return cleaned.slice(0, 2000);
}

export function extractPlaceFromText(text: string): {
  city: string | null;
  state: string | null;
} {
  for (const rule of PLACE_RULES) {
    if (rule.re.test(text || "")) {
      return {
        city: rule.city,
        state: rule.state,
      };
    }
  }
  return { city: null, state: null };
}

export type ExtractedUsStreetAddress = {
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  /** Optional «North Hollywood — My Barber LA» before the street. */
  label: string | null;
};

function normalizeUsState(match: RegExpExecArray): string | null {
  let state = (match[3] || "").trim().toUpperCase();
  if (!state) {
    const after = (match[0] || "").toLowerCase();
    if (after.includes("california") || /\bca\b/.test(after)) state = "CA";
    else if (after.includes("washington")) state = "WA";
    else if (after.includes("florida")) state = "FL";
    else if (after.includes("oregon")) state = "OR";
    else if (after.includes("texas")) state = "TX";
    else if (after.includes("new york")) state = "NY";
  }
  return state || null;
}

function labelBeforeStreet(text: string, streetStart: number): string | null {
  // «North Hollywood — My Barber LA 5957 Laurel…» → label before house number.
  const window = text.slice(Math.max(0, streetStart - 80), streetStart);
  const hit = window.match(
    /([A-ZА-ЯЁ][\p{L}\p{N}.'\-]{1,40}(?:\s+[A-ZА-ЯЁa-zа-яё][\p{L}\p{N}.'\-]{0,40}){0,5})\s*[—–-]\s*([A-ZА-ЯЁ][\p{L}\p{N}.'\-]{1,40}(?:\s+[A-ZА-ЯЁa-zа-яё][\p{L}\p{N}.'\-]{0,40}){0,5})\s*$/u,
  );
  if (!hit) return null;
  const area = hit[1].trim();
  const place = hit[2].trim();
  if (area.length < 2 || place.length < 2) return null;
  return `${area} — ${place}`.slice(0, 80);
}

/** First US street + city + state + ZIP in the text. */
export function extractUsStreetAddress(text: string): ExtractedUsStreetAddress {
  const all = extractUsStreetAddresses(text);
  return (
    all[0] ?? {
      addressLine: null,
      city: null,
      state: null,
      postalCode: null,
      label: null,
    }
  );
}

/**
 * Every US street address in the text, in order of appearance.
 * Used when a company lists several pickup / office points in one ad.
 */
export function extractUsStreetAddresses(
  text: string,
): ExtractedUsStreetAddress[] {
  const source = text || "";
  if (!source.trim()) return [];
  const global = new RegExp(US_STREET_ADDRESS_RE.source, "gi");
  const out: ExtractedUsStreetAddress[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = global.exec(source)) !== null) {
    const street = (match[1] || "").replace(/\s+/g, " ").trim();
    const city = (match[2] || "").replace(/\s+/g, " ").trim();
    const state = normalizeUsState(match);
    const postalCode = (match[4] || "").trim() || null;
    if (!street) continue;
    const key = `${street}|${city}|${state}|${postalCode}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      addressLine: street.slice(0, 160),
      city: city || null,
      state,
      postalCode,
      label: labelBeforeStreet(source, match.index),
    });
  }
  return out;
}

/** Instagram fancy unicode letters → ASCII. */
/** Normalize fancy unicode digits/letters (e.g. 3️⃣, 🔠) to ASCII. */
export function demathAlnum(text: string): string {
  return Array.from(text || "")
    .map((ch) => {
      const cp = ch.codePointAt(0);
      if (cp == null) return ch;
      // Bold / italic / sans / mono capital A–Z blocks (subset)
      const ranges: [number, number, number][] = [
        [0x1d400, 0x1d419, 65],
        [0x1d41a, 0x1d433, 97],
        [0x1d5d4, 0x1d5ed, 65], // sans-serif bold caps
        [0x1d5ee, 0x1d607, 97],
        [0x1d56c, 0x1d585, 65], // sans-serif bold italic caps
        [0x1d586, 0x1d59f, 97],
        [0x1d7ce, 0x1d7d7, 48], // bold digits
        [0x1d7ec, 0x1d7f5, 48], // sans bold digits
      ];
      for (const [start, end, base] of ranges) {
        if (cp >= start && cp <= end) {
          return String.fromCharCode(base + (cp - start));
        }
      }
      return ch;
    })
    .join("");
}

/** Strip URLs/phones/IG stats for a cleaner description candidate. */
export function extractDescriptionFromText(text: string): string | null {
  let cleaned = demathAlnum(text || "").trim();
  if (!cleaned) return null;
  // Google Maps / Apple Maps UI dump — not narrative.
  const chromeHits = mapsChromeHitCount(cleaned);
  if (chromeHits >= 2) return null;
  if (
    DAY_LINE_RE.test(cleaned) &&
    HOURS_RANGE_RE.test(cleaned) &&
    chromeHits >= 1
  ) {
    return null;
  }
  cleaned = cleaned.replace(IG_STATS_LINE_RE, " ");
  cleaned = cleaned.replace(URL_SPAN_RE, " ");
  cleaned = cleaned.replace(BARE_WEBSITE_RE, " ");
  cleaned = cleaned.replace(EMAIL_RE, " ");
  // Address first: a greedy phone span would otherwise swallow the house
  // number and leave «E 17th St, Costa Mesa, CA 92627» inside the description.
  cleaned = cleaned.replace(US_STREET_ADDRESS_RE, " ");
  cleaned = cleaned.replace(PHONE_SPAN_RE, " ");
  cleaned = cleaned.replace(PHONE_LABEL_RE, " ");
  // Drop bare username-only / label-only lines
  cleaned = cleaned
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (DAY_LINE_RE.test(line)) return false;
      if (HOURS_RANGE_RE.test(line) && line.length < 40) return false;
      if (
        /^(blogger|creator|artist|personal\s*blog|book\s*now|my\s*website|website|facebook|instagram|links?|open\s*now|directions|overview|reviews|about|suggest\s*new\s*hours)$/i.test(
          line,
        )
      ) {
        return false;
      }
      if (/^@?[A-Za-z0-9._]{3,30}$/.test(line)) return false;
      if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(\/.*)?$/i.test(line)) return false;
      return true;
    })
    .join("\n");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (cleaned.length < 20) return null;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 4) return null;
  // Link-list paste (Book now / My Website / …) — not a real bio
  const bareHosts = [...(text || "").matchAll(BARE_WEBSITE_RE)].length;
  const fullUrls = [...(text || "").matchAll(WEBSITE_RE)].length;
  if (bareHosts + fullUrls >= 2 && words.length < 14) return null;
  if (
    /^(ссылки|links)\b/i.test(cleaned) &&
    !/\b(training|procedures|technique|brows|lips)\b/i.test(cleaned)
  ) {
    return null;
  }
  return cleaned.slice(0, 2000);
}

export function parsePasteEnrichText(text: string): PasteEnrichExtracted {
  const normalized = demathAlnum(text || "");
  const phones = extractPhonesFromText(normalized);
  const emails = extractEmailsFromText(normalized);
  const facebook = extractFacebookFromText(normalized);
  const whatsapp = extractWhatsAppFromText(normalized);
  const googleMaps = extractGoogleMapsFromText(normalized);
  const websites = extractWebsitesFromText(normalized);
  const instagram = extractInstagramFromText(normalized);
  const tgs = extractTelegramFromText(normalized);
  const street = extractUsStreetAddress(normalized);
  const place = extractPlaceFromText(normalized);
  const description = extractDescriptionFromText(text);
  const openingHours = extractOpeningHoursFromText(text);
  // Phone from WhatsApp short link when no other phone was found.
  if (whatsapp && phones.length === 0) {
    const digits = whatsapp.replace(/\D/g, "");
    if (digits.length >= 10) {
      const phone = normalizePhone(digits);
      if (phone) phones.push(phone);
    }
  }
  return {
    name: null,
    phone: phones.slice(0, 3),
    email: emails.slice(0, 3),
    website: websites.slice(0, 3),
    instagram: instagram.slice(0, 3),
    telegram: tgs[0] ?? null,
    facebook,
    whatsapp,
    googleMaps,
    city: street.city || place.city,
    state: street.state || place.state,
    addressLine: street.addressLine,
    postalCode: street.postalCode,
    description,
    openingHours,
  };
}

/**
 * Build preview rows: what will be added vs skipped (fill-empty).
 * `hasPhotoFile` — user attached an image in the modal.
 */
export function buildPasteEnrichPreview(
  existing: PasteEnrichExisting,
  extracted: PasteEnrichExtracted,
  hasPhotoFile: boolean,
): PasteEnrichPreviewItem[] {
  const rows: PasteEnrichPreviewItem[] = [];

  if (extracted.name) {
    rows.push({
      key: "name",
      label: FIELD_LABELS.name,
      value: extracted.name,
      action: emptyScalar(existing.name) ? "add" : "skip",
    });
  }

  const pushList = (
    key: PasteEnrichFieldKey,
    extractedVals: string[],
    existingEmpty: boolean,
    format?: (v: string) => string,
  ) => {
    if (extractedVals.length === 0) return;
    const display = extractedVals.map((v) => (format ? format(v) : v)).join(", ");
    rows.push({
      key,
      label: FIELD_LABELS[key],
      value: display,
      action: existingEmpty ? "add" : "skip",
    });
  };

  pushList("phone", extracted.phone, emptyList(existing.phone));
  pushList("email", extracted.email, emptyList(existing.email));
  pushList("website", extracted.website, emptyList(existing.website));
  pushList(
    "instagram",
    extracted.instagram,
    emptyList(existing.instagram),
    (h) => `@${h}`,
  );

  if (extracted.telegram) {
    rows.push({
      key: "telegram",
      label: FIELD_LABELS.telegram,
      value: `@${extracted.telegram}`,
      action: emptyScalar(existing.telegram) ? "add" : "skip",
    });
  }

  if (extracted.facebook) {
    rows.push({
      key: "facebook",
      label: FIELD_LABELS.facebook,
      value: extracted.facebook,
      action: emptyScalar(existing.facebook) ? "add" : "skip",
    });
  }

  if (extracted.whatsapp) {
    rows.push({
      key: "whatsapp",
      label: FIELD_LABELS.whatsapp,
      value: extracted.whatsapp,
      action: emptyList(existing.whatsapp) ? "add" : "skip",
    });
  }

  if (extracted.googleMaps) {
    rows.push({
      key: "googleMaps",
      label: FIELD_LABELS.googleMaps,
      value: extracted.googleMaps,
      action: emptyScalar(existing.googleMaps) ? "add" : "skip",
    });
  }

  if (extracted.city) {
    rows.push({
      key: "city",
      label: FIELD_LABELS.city,
      value: extracted.city,
      action: emptyScalar(existing.city) ? "add" : "skip",
    });
  }

  if (extracted.state) {
    rows.push({
      key: "state",
      label: FIELD_LABELS.state,
      value: extracted.state,
      action: emptyScalar(existing.state) ? "add" : "skip",
    });
  }

  if (extracted.addressLine) {
    rows.push({
      key: "address",
      label: FIELD_LABELS.address,
      value: extracted.addressLine,
      action: emptyScalar(existing.addressLine) ? "add" : "skip",
    });
  }

  if (extracted.postalCode) {
    rows.push({
      key: "postal",
      label: FIELD_LABELS.postal,
      value: extracted.postalCode,
      action: emptyScalar(existing.postalCode) ? "add" : "skip",
    });
  }

  if (extracted.openingHours) {
    rows.push({
      key: "openingHours",
      label: FIELD_LABELS.openingHours,
      value: formatOpeningHoursPreview(extracted.openingHours),
      action: emptyOpeningHours(existing.openingHours) ? "add" : "skip",
    });
  }

  if (extracted.description) {
    rows.push({
      key: "description",
      label: FIELD_LABELS.description,
      value:
        extracted.description.length > 120
          ? `${extracted.description.slice(0, 117)}…`
          : extracted.description,
      action: isWeakDescription(existing.description) ? "add" : "skip",
    });
  } else if (isWeakDescription(existing.description) && existing.description?.trim()) {
    const scrubbed = scrubWeakDescription(existing.description);
    if (scrubbed !== existing.description.trim()) {
      rows.push({
        key: "description",
        label: FIELD_LABELS.description,
        value: scrubbed
          ? scrubbed.length > 120
            ? `${scrubbed.slice(0, 117)}…`
            : scrubbed
          : "(убрать ссылки)",
        action: "add",
      });
    }
  }

  if (hasPhotoFile) {
    rows.push({
      key: "image",
      label: FIELD_LABELS.image,
      value: "прикреплённый файл",
      action: emptyScalar(existing.imageUrl) ? "add" : "skip",
    });
  }

  return rows;
}

/** Patch object with only fill-empty fields from extracted (+ optional image URL). */
export function pasteEnrichFillEmptyPatch(
  existing: PasteEnrichExisting,
  extracted: PasteEnrichExtracted,
  imageUrl: string | null,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (emptyScalar(existing.name) && extracted.name) {
    patch.name = extracted.name;
  }
  if (emptyList(existing.phone) && extracted.phone.length) {
    patch.phone = extracted.phone;
  }
  if (emptyList(existing.email) && extracted.email.length) {
    patch.email = extracted.email;
  }
  if (emptyList(existing.website) && extracted.website.length) {
    patch.website = extracted.website;
  }
  if (emptyList(existing.instagram) && extracted.instagram.length) {
    patch.instagram = extracted.instagram;
  }
  if (emptyScalar(existing.telegram) && extracted.telegram) {
    patch.telegram = extracted.telegram;
  }
  if (emptyScalar(existing.facebook) && extracted.facebook) {
    patch.facebook = extracted.facebook;
  }
  if (emptyList(existing.whatsapp) && extracted.whatsapp) {
    patch.whatsapp = extracted.whatsapp;
  }
  if (emptyScalar(existing.googleMaps) && extracted.googleMaps) {
    patch.googleMaps = extracted.googleMaps;
  }
  if (emptyScalar(existing.city) && extracted.city) {
    patch.city = extracted.city;
  }
  if (emptyScalar(existing.state) && extracted.state) {
    patch.state = extracted.state;
  }
  if (emptyScalar(existing.addressLine) && extracted.addressLine) {
    patch.addressLine = extracted.addressLine;
  }
  if (emptyScalar(existing.postalCode) && extracted.postalCode) {
    patch.postalCode = extracted.postalCode;
  }
  if (emptyOpeningHours(existing.openingHours) && extracted.openingHours) {
    patch.openingHours = extracted.openingHours;
  }
  if (isWeakDescription(existing.description)) {
    if (extracted.description) {
      patch.description = extracted.description;
    } else if (existing.description?.trim()) {
      const scrubbed = scrubWeakDescription(existing.description);
      if (scrubbed !== existing.description.trim()) {
        patch.description = scrubbed ?? "";
      }
    }
  }
  if (emptyScalar(existing.imageUrl) && imageUrl) {
    patch.imageUrl = imageUrl;
  }
  return patch;
}

/** Prefer street-parsed city; OC fallback only if nothing else. */
export function parsePasteEnrichTextNormalized(text: string): PasteEnrichExtracted {
  return parsePasteEnrichText(text);
}
