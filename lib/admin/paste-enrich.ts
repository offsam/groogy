/**
 * Admin paste-enrich: extract contacts/location/description from free text.
 * Fill-empty only — mirrors Python step_source_text (no LLM).
 */

import type { OpeningHours, OpeningHoursDay } from "@/lib/business/opening-hours";
import { dayLabelRu } from "@/lib/business/opening-hours";
import type { ParsedMenuItem } from "@/lib/business-offers/parse-menu-text";
import {
  looksLikeMenuDocument,
  parseMenuFromText,
} from "@/lib/business-offers/parse-menu-text";

export type PasteEnrichExisting = {
  /** Company / display name — fill-empty from paste when missing. */
  name?: string | null;
  phone?: string | string[] | null;
  email?: string | string[] | null;
  website?: string | string[] | null;
  /** Handle, URL, or list — normalized for emptiness check. */
  instagram?: string | string[] | null;
  telegram?: string | null;
  facebook?: string | null;
  /** YouTube channel URL → contact_links.youtube */
  youtube?: string | null;
  whatsapp?: string | string[] | null;
  /** Yelp biz URL — businesses `yelp_url`, not website. */
  yelp?: string | null;
  /** Trustpilot review URL — businesses `trustpilot_url` + contact_links. */
  trustpilot?: string | null;
  googleMaps?: string | null;
  /** Google Maps star rating 0–5 (businesses + professionals). */
  googleRating?: number | null;
  googleReviewsCount?: number | null;
  /** Yelp star rating 0–5 (businesses + professionals). */
  yelpRating?: number | null;
  yelpReviewsCount?: number | null;
  /** Trustpilot TrustScore 0–5 (businesses + professionals). */
  trustpilotRating?: number | null;
  trustpilotReviewsCount?: number | null;
  /** Facebook «X% recommend» 0–100 (businesses + professionals). */
  facebookRecommendPct?: number | null;
  facebookReviewsCount?: number | null;
  city?: string | null;
  state?: string | null;
  addressLine?: string | null;
  postalCode?: string | null;
  /** Saved map pin — used to decide address replace vs skip. */
  latitude?: number | null;
  longitude?: number | null;
  locationPrecision?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  openingHours?: OpeningHours | null;
  /** Existing service / offer titles (queue `services[]` or live offers). */
  services?: string[] | null;
};

export type PasteEnrichExtracted = {
  /** Null unless the caller ran name inference (`parsePasteEnrichTextWithName`). */
  name: string | null;
  phone: string[];
  email: string[];
  website: string[];
  instagram: string[];
  telegram: string | null;
  facebook: string | null;
  youtube: string | null;
  whatsapp: string | null;
  yelp: string | null;
  trustpilot: string | null;
  googleMaps: string | null;
  googleRating: number | null;
  googleReviewsCount: number | null;
  yelpRating: number | null;
  yelpReviewsCount: number | null;
  trustpilotRating: number | null;
  trustpilotReviewsCount: number | null;
  facebookRecommendPct: number | null;
  facebookReviewsCount: number | null;
  city: string | null;
  state: string | null;
  addressLine: string | null;
  postalCode: string | null;
  description: string | null;
  openingHours: OpeningHours | null;
  /** Google Maps «Services: A, B, C» / «Услуги: …» labels. */
  services: string[];
  /**
   * Priced labor / service rows («Mechanical Labor $90», rate tables).
   * Applied as offers with price_amount; titles also appear in `services`.
   */
  pricedServices: PastePricedService[];
  /** Restaurant menu dishes (section + price) from pasted / OCR menu boards. */
  menuItems: ParsedMenuItem[];
};

export type PastePricedService = {
  title: string;
  priceAmount: number;
  /** Rate table said per hour / hr. */
  perHour?: boolean;
};

export type PasteEnrichFieldKey =
  | "name"
  | "phone"
  | "email"
  | "website"
  | "instagram"
  | "telegram"
  | "facebook"
  | "youtube"
  | "whatsapp"
  | "yelp"
  | "trustpilot"
  | "googleMaps"
  | "googleRating"
  | "yelpRating"
  | "trustpilotRating"
  | "facebookRecommend"
  | "city"
  | "state"
  | "address"
  | "postal"
  | "description"
  | "openingHours"
  | "services"
  | "menu"
  | "image";

export type PasteEnrichPreviewItem = {
  key: PasteEnrichFieldKey;
  label: string;
  value: string;
  /** add = empty field; replace = card has something else; skip = same / keep. */
  action: "add" | "skip" | "replace";
  /** Current card value when action is replace (for the preview line). */
  currentValue?: string | null;
  /** Optional note under the value (e.g. geocode gate). */
  hint?: string | null;
};

/** Result of geocoding card vs pasted street before proposing replace. */
export type PasteAddressGeoGate = {
  pastedPins: boolean;
  cardPins: boolean;
};

/**
 * Decide address preview action after both sides were checked for a street pin.
 * Never auto-applies — caller still requires a checkbox for replace.
 */
export function pasteAddressPreviewAction(input: {
  existingEmpty: boolean;
  streetsDiffer: boolean;
  pastedPins: boolean;
  cardPins: boolean;
}): "add" | "skip" | "replace" {
  if (input.existingEmpty) {
    // Do not fill empty with a dead address.
    return input.pastedPins ? "add" : "skip";
  }
  if (!input.pastedPins) return "skip";
  // Pasted works, card does not → offer replace (even if text is similar).
  if (!input.cardPins) return "replace";
  // Both pin — only offer when streets are different.
  return input.streetsDiffer ? "replace" : "skip";
}

export function cardHasStreetPin(existing: PasteEnrichExisting): boolean {
  const lat = existing.latitude;
  const lng = existing.longitude;
  if (lat == null || lng == null) return false;
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return false;
  }
  const precision = (existing.locationPrecision || "").toLowerCase();
  return precision === "street";
}

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
/** Bare hosts with optional path (glossgenius.com/x, framer.website, eurodeli.us). */
const BARE_WEBSITE_RE =
  /(?<![A-Za-z0-9@/])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|io|co|us|ru|ua|info|biz|pro|ai|app|me|link|cc|website|studio|shop|store|online|site)(?:\/[^\s<>"']*)?)/gi;
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
  "yelp.com",
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
  "trustpilot.com",
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
  "yelp.com",
  "trustpilot.com",
  "t.me",
  "telegram.me",
  "youtube.com",
  "youtu.be",
]);

const FACEBOOK_URL_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:facebook\.com|fb\.com|fb\.me)\/[A-Za-z0-9._\-/]+/gi;
const YOUTUBE_URL_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:@[\w.-]+|(?:c|channel|user)\/[\w.-]+)(?:\/[^\s<>"']*)?|youtu\.be\/[\w-]{6,})/gi;
const YOUTUBE_LABELED_RE =
  /(?:youtube|ютуб)\s*[:：]\s*(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/)?@?([A-Za-z0-9._-]{2,64})\b/gi;
const YELP_URL_RE =
  /(?:https?:\/\/)?(?:www\.)?yelp\.com\/biz\/[A-Za-z0-9._\-%]+/gi;
const TRUSTPILOT_URL_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:[a-z]{2}\.)?trustpilot\.com\/review\/[A-Za-z0-9._\-%]+/gi;
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

/**
 * US street + city + state, ZIP optional.
 * Unit may sit after the street type with a space («Rd ste 210») or a comma
 * («Rd, Suite 210») — Google Maps uses both.
 * Also: County Road 42 EAST, trailing N/S/E/W, and newline before city.
 */
const US_STREET_TYPE =
  "(?:Ave|Avenue|Street|Str|St|Blvd|Boulevard|Rd|Road|Dr|Drive|Way|Ln|Lane|Ct|Court|Pl|Place|Hwy|Highway|Pkwy|Parkway|Cir|Circle|Ter|Terrace|Trl|Trail|Loop|Sq|Square)";
const US_UNIT =
  "(?:Ste|Suite|Unit|Apt|#)\\.?[ \\t]*[A-Za-z0-9\\-]+";
const US_DIR =
  "(?:N|S|E|W|NE|NW|SE|SW|North|South|East|West)";
/** «1800 County Road 42 EAST» / «500 Hwy 99» — type before route number. */
const US_NUMBERED_ROAD =
  `(?:County[ \\t]+(?:Road|Rd)|CR|State[ \\t]+(?:Route|Hwy|Highway|Rd|Road)|SR|US[ \\t]*(?:Hwy|Highway)|(?:State[ \\t]+)?(?:Hwy|Highway)|Interstate|I-?)[ \\t]*\\d+[A-Za-z]?(?:[ \\t]+${US_DIR})?`;
/** «123 Main St» / «123 Main St E» / «123 Main Rd, Suite 210». */
const US_NAMED_STREET =
  `[A-Za-z0-9.'\\-]+(?:[ \\t]+[A-Za-z0-9.'\\-]+){0,6}[ \\t]+${US_STREET_TYPE}\\.?(?:[ \\t]+${US_DIR})?(?:(?:[ \\t]+|,[ \\t]*)${US_UNIT})?`;
const US_STREET_CORE =
  `((?<![\\d\\-])\\d{1,6}[ \\t]+(?:${US_NUMBERED_ROAD}|${US_NAMED_STREET}))`;
const US_CITY_STATE_ZIP =
  `([A-Za-z][A-Za-z.\\s]+?)\\s*,\\s*(?:([A-Z]{2})|California|CA|Washington|WA|New\\s*York|NY|Florida|FL|Oregon|OR|Texas|TX|Minnesota|MN)(?:\\s+(\\d{5})(?:-\\d{4})?)?`;
/** Comma or newline between street and «City, ST ZIP». */
const US_STREET_ADDRESS_RE = new RegExp(
  `${US_STREET_CORE}\\s*(?:,|\\n)\\s*${US_CITY_STATE_ZIP}`,
  "i",
);

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
  youtube: "YouTube",
  whatsapp: "WhatsApp",
  yelp: "Yelp",
  trustpilot: "Trustpilot",
  googleMaps: "Google Maps",
  googleRating: "Google рейтинг",
  yelpRating: "Yelp рейтинг",
  trustpilotRating: "Trustpilot рейтинг",
  facebookRecommend: "Facebook рекомендации",
  city: "Город",
  state: "Штат",
  address: "Адрес",
  postal: "ZIP",
  description: "Описание",
  openingHours: "Часы работы",
  services: "Услуги",
  menu: "Меню",
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
  /\b(?:directions|overview|reviews|about|nearby|send to phone|suggest new hours|open now|save|share|services|photos|products|call|closed|маршрут|обзор|отзывы|о\s*нас|поблизости|отправить\s+на\s+телефон|предложить\s+новые\s+часы|открыто\s+сейчас|сохранить|поделиться|позвонить|закрыто|фото|товары)\b/gi;

/** One paste «service» that is Maps chrome / hours / address — not an offer. */
const SERVICE_JUNK_LABEL_RE =
  /^(?:directions|overview|reviews|about|nearby|send to phone|suggest new hours|open now|save|share|services|photos|products|call|closed|website|меню|menu|маршрут|обзор|отзывы|о\s*нас|поблизости|отправить\s+на\s+телефон|предложить\s+новые\s+часы(?:\s+работы)?|открыто\s+сейчас|сохранить|поделиться|позвонить|закрыто|фото|товары|карта|map|адрес|address|телефон\w*|phone|часы(?:\s+работы)?|hours?(?:\s+of\s+operation)?|подтверждено\s+этим\s+бизнесом.*|confirmed\s+by\s+this\s+business.*)$/i;

/** 24h «8:00–19:00» (RU Maps) or AM/PM ranges. */
const SERVICE_HOURS_ONLY_RE =
  /^(?:\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)\s*[–—−-]\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)|\d{1,2}[:.]\d{2}\s*[–—−-]\s*\d{1,2}[:.]\d{2})$/;

function isJunkServiceLabel(raw: string): boolean {
  const part = raw
    .replace(/[\uE000-\uF8FF]/g, "")
    .replace(/[·•∙⋅]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (part.length < 3 || part.length > 80) return true;
  if (!/[A-Za-zА-Яа-яЁё]/.test(part)) return true;
  if (/^\d+$/.test(part)) return true;
  if (SERVICE_JUNK_LABEL_RE.test(part)) return true;
  if (DAY_LINE_RE.test(part)) return true;
  if (SERVICE_HOURS_ONLY_RE.test(part)) return true;
  if (HOURS_RANGE_RE.test(part) && part.length < 40) return true;
  // Rating chrome: «4.5 258 отзывов Google», «100 Reviews».
  if (
    /^\d+(?:[.,]\d+)?\s*(?:\(?\d[\d,]*\)?)?\s*(?:отзыв\w*|reviews?)\b/i.test(
      part,
    ) ||
    /(?:отзыв\w*|reviews?)\s+google\b/i.test(part)
  ) {
    return true;
  }
  // Street / city-state-ZIP fragments from a Maps dump after «Услуги:».
  if (
    /^\d{1,6}\s+\S+/.test(part) &&
    /\b(?:st|str|street|ave|avenue|blvd|rd|road|dr|hwy|pkwy|ln|ct|pl|way)\b/i.test(
      part,
    )
  ) {
    return true;
  }
  if (
    /^[A-Za-zА-Яа-яЁё .'’-]+,\s*[A-ZА-Я]{2}\s+\d{5}(?:-\d{4})?$/i.test(part)
  ) {
    return true;
  }
  if (/^(?:US-)?[A-Z]{2}\s+\d{5}(?:-\d{4})?$/i.test(part)) return true;
  if (/^\d{5}(?:-\d{4})?$/.test(part)) return true;
  return false;
}

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
  /^(sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|воскресенье|вс|понедельник|пн|вторник|вт|среда|ср|четверг|чт|пятница|пт|суббота|сб)(?=$|[^\p{L}\p{N}])/iu;

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

function normPlace(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/^us-/, "")
    .replace(/[^a-z0-9а-яё]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normZip(value: string | null | undefined): string {
  return (value || "").replace(/\D/g, "").slice(0, 5);
}

/** Empty → add; same → skip; different → replace (user can apply). */
function scalarPreviewAction(
  existing: string | null | undefined,
  incoming: string | null | undefined,
  same: (a: string, b: string) => boolean = (a, b) =>
    normPlace(a) === normPlace(b),
): "add" | "skip" | "replace" {
  const next = (incoming || "").trim();
  if (!next) return "skip";
  const cur = (existing || "").trim();
  if (!cur) return "add";
  return same(cur, next) ? "skip" : "replace";
}

/** House number + street name key — suite / Ave vs Avenue ignored. */
export function streetIdentity(value: string | null | undefined): string {
  const v = (value || "")
    .toLowerCase()
    .replace(
      /,?\s*\b(?:ste|suite|unit|apt|apartment|bldg|building|fl|floor|room|rm|office)\b\.?\s*#?\s*(?:[\w-]{1,8}|[a-z]{1,2})\b/gi,
      " ",
    )
    .replace(/[^\w\s]/g, " ")
    .replace(
      /\b(avenue|ave|street|st|boulevard|blvd|drive|dr|road|rd|lane|ln|court|ct|way|parkway|pkwy|place|pl|circle|cir|terrace|ter)\b/g,
      " ",
    );
  return v.replace(/\s+/g, " ").trim();
}

/**
 * Pasted / website street is stronger than telegram glue already on the card.
 * Same house number+street → keep existing; different street → replace.
 */
export function preferWebsiteStreet(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): boolean {
  const web = (incoming || "").trim();
  if (!web || !/^\d{1,6}\s+\S/.test(web)) return false;
  const cur = (existing || "").trim();
  if (!cur || !/^\d{1,6}\s+\S/.test(cur)) return true;
  return streetIdentity(cur) !== streetIdentity(web);
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

export function extractYelpFromText(text: string): string | null {
  for (const match of (text || "").matchAll(YELP_URL_RE)) {
    const url = normalizeUrl(match[0] || "");
    if (!url) continue;
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      if (host !== "yelp.com" && !host.endsWith(".yelp.com")) continue;
      const path = u.pathname.replace(/\/+$/, "");
      if (!path.startsWith("/biz/")) continue;
      const slug = path.slice("/biz/".length);
      if (!slug || slug.includes("/")) continue;
      return `https://www.yelp.com/biz/${decodeURIComponent(slug)}`;
    } catch {
      continue;
    }
  }
  return null;
}

export function extractTrustpilotFromText(text: string): string | null {
  for (const match of (text || "").matchAll(TRUSTPILOT_URL_RE)) {
    const url = normalizeUrl(match[0] || "");
    if (!url) continue;
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      if (host !== "trustpilot.com" && !host.endsWith(".trustpilot.com")) {
        continue;
      }
      const path = u.pathname.replace(/\/+$/, "");
      const m = path.match(/^\/review\/([^/]+)$/i);
      if (!m?.[1]) continue;
      return `https://www.trustpilot.com/review/${decodeURIComponent(m[1])}`;
    } catch {
      continue;
    }
  }
  return null;
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

/** Channel / @handle URLs only — skip bare watch?v= video links. */
export function extractYouTubeFromText(text: string): string | null {
  for (const match of (text || "").matchAll(YOUTUBE_URL_RE)) {
    const url = normalizeUrl(match[0] || "");
    if (!url) continue;
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      if (host === "youtu.be") {
        // Short video links are not a channel contact.
        continue;
      }
      if (host !== "youtube.com") continue;
      const path = u.pathname.replace(/\/+$/, "");
      if (!path || path === "/") continue;
      if (/^\/watch/i.test(path) || /^\/shorts\//i.test(path)) continue;
      if (
        !/^\/@/.test(path) &&
        !/^\/c\//i.test(path) &&
        !/^\/channel\//i.test(path) &&
        !/^\/user\//i.test(path)
      ) {
        continue;
      }
      return `https://www.youtube.com${path.split("/").slice(0, 3).join("/")}`;
    } catch {
      continue;
    }
  }
  for (const match of (text || "").matchAll(YOUTUBE_LABELED_RE)) {
    const handle = (match[1] || "").replace(/^@/, "").trim();
    if (!handle || /^(com|www|http|https|channel|user|watch)$/i.test(handle)) {
      continue;
    }
    if (/^UC[\w-]{20,}$/i.test(handle)) {
      return `https://www.youtube.com/channel/${handle}`;
    }
    return `https://www.youtube.com/@${handle}`;
  }
  // Multiline: «YouTube\nyoutube.com/@foo» already covered by URL_RE;
  // «YouTube\n@foo» without host:
  const labeledBlock = (text || "").match(
    /(?:^|\n)\s*(?:youtube|ютуб)\s*[:：]?\s*\n\s*@([A-Za-z0-9._-]{2,64})\b/i,
  );
  if (labeledBlock?.[1]) {
    return `https://www.youtube.com/@${labeledBlock[1]}`;
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

export function isJunkEmail(email: string | null | undefined): boolean {
  const e = (email || "").trim().toLowerCase();
  if (!e || !e.includes("@")) return true;
  const [localRaw, domainRaw] = e.split("@");
  const local = (localRaw || "").split("+", 1)[0];
  const domain = domainRaw || "";
  if (
    /@(?:dikidi|glossgenius|fresha|vagaro|booksy)\./i.test(e)
  ) {
    return true;
  }
  const junkLocals = new Set([
    "user",
    "username",
    "yourname",
    "name",
    "email",
    "test",
    "testing",
    "example",
    "sample",
    "noreply",
    "no-reply",
    "donotreply",
    "mail",
    "you",
    "me",
    "abc",
    "xyz",
  ]);
  if (junkLocals.has(local)) return true;
  const junkDomains = [
    "godaddy.com",
    "example.com",
    "email.com",
    "domain.com",
    "sentry.io",
    "wixpress.com",
    "squarespace.com",
    "eyebytes.com",
    "ndiscovered.com",
    "dikidi.net",
    "dikidi.app",
    "glossgenius.com",
    "booksy.com",
    "vagaro.com",
    "squareup.com",
    "calendly.com",
    "fresha.com",
  ];
  return junkDomains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export function extractEmailsFromText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of (text || "").matchAll(EMAIL_RE)) {
    const e = (match[0] || "").toLowerCase();
    if (isJunkEmail(e)) continue;
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
 * PostalAddress blobs embedded in JSON-LD or CRA/Vite JS bundles
 * (`streetAddress:"600 N Brand…"`).
 */
export function extractSpaPostalAddressLines(blob: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /streetAddress["']?\s*:\s*["']([^"']{5,120})["']/gi;
  for (const m of blob.matchAll(re)) {
    const street = (m[1] || "").trim();
    if (!street) continue;
    const start = m.index ?? 0;
    const window = blob.slice(start, Math.min(blob.length, start + 480));
    const city = window.match(
      /addressLocality["']?\s*:\s*["']([^"']{2,80})["']/i,
    )?.[1];
    const region = window.match(
      /addressRegion["']?\s*:\s*["']([^"']{2,40})["']/i,
    )?.[1];
    const zip = window.match(
      /postalCode["']?\s*:\s*["']([^"']{3,20})["']/i,
    )?.[1];
    const line = [street, city, region, zip].filter(Boolean).join(", ");
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out.slice(0, 8);
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

/**
 * Labor / service rate tables — including glued OCR dumps:
 * «Mechanical Labor$90Electrical Labor$100».
 */
const PRICED_SERVICE_PAIR_RE =
  /([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9 /&'.+-]{1,48}?)\s*\$\s*(\d{1,5})(?:[.,]\d{2})?/g;

const PRICED_SERVICE_TITLE_JUNK_RE =
  /^(?:service\s*types?|service\s*rates?|rates?|pricing|price|per\s*hours?|hours?|hr|usd|from|type|labor\s*structure|structure|tier(?:-based)?|explicit|operates?|shop|the\s+shop|and|or|a|an|of|to|for|with|under|based)$/i;

const RATE_TABLE_CUE_RE =
  /(?:service\s*rates?|rates?\s*&?\s*pricing|rate\s*\(\s*per\s*hour|per\s*hour|labor\s*(?:rate|\$)|welding\s*\$|mechanical\s+labor|electrical\s+labor)/i;

function looksLikeRateTable(text: string): boolean {
  const dollars = (text || "").match(/\$\s*\d{2,5}/g) || [];
  return dollars.length >= 2 && RATE_TABLE_CUE_RE.test(text || "");
}

export function extractPricedServicesFromText(
  text: string,
): PastePricedService[] {
  const source = demathAlnum(text || "").replace(/\r\n?/g, "\n");
  if (!source.trim()) return [];

  const perHour =
    /\b(?:per\s*hour|\/\s*hr|\/\s*hour|в\s*час|за\s*час)\b/i.test(source) ||
    /rate\s*\(\s*per\s*hour/i.test(source);

  const found: PastePricedService[] = [];
  const seen = new Set<string>();
  for (const match of source.matchAll(PRICED_SERVICE_PAIR_RE)) {
    let title = (match[1] || "")
      .replace(/^[\s:：|·•\-–—*]+/, "")
      .replace(/[\s:：|·•\-–—*]+$/, "")
      .replace(/\s+/g, " ")
      .trim();
    // Glued header tail: «Hour)Mechanical Labor» / «HourMechanical Labor»
    title = title
      .replace(/^.*?\b(?:hour|hr|type|rate|pricing)\)?\s*/i, "")
      .replace(/^[^A-Za-zА-Яа-яЁё]+/, "")
      .trim();
    const amount = Number(String(match[2] || "").replace(",", "."));
    if (!title || title.length < 3 || title.length > 60) continue;
    if (title.split(/\s+/).length > 6) continue;
    if (PRICED_SERVICE_TITLE_JUNK_RE.test(title)) continue;
    if (!/[A-Za-zА-Яа-яЁё]{3,}/.test(title)) continue;
    if (!Number.isFinite(amount) || amount < 5 || amount > 50_000) continue;
    // Star-like crumbs; labor rates are usually ≥15.
    if (amount < 15 && !perHour) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({
      title,
      priceAmount: Math.round(amount * 100) / 100,
      perHour,
    });
    if (found.length >= 20) break;
  }

  if (found.length >= 2) return found;
  if (found.length === 1 && RATE_TABLE_CUE_RE.test(source)) return found;
  return [];
}

/**
 * Google Maps «Services: Teeth whitening, Invisalign, …» /
 * «Услуги: …» — comma / and / и separated labels.
 * Rejects Maps chrome dumps (О нас / дни недели / адрес) after «Услуги:».
 */
export function extractServicesFromText(text: string): string[] {
  const source = demathAlnum(text || "");
  if (!source.trim()) return [];

  const labeled =
    /(?:^|\n)\s*(?:services?|услуг[аиеы]?|предлагаем(?:\s+услуги)?)\s*[:：]\s*([^\n]+)/i.exec(
      source,
    );
  let body = labeled?.[1]?.trim() || "";
  let fromNextLine = false;

  if (!body) {
    // Header alone on one line, list on the next.
    const lines = source.split(/\n+/).map((l) => l.trim());
    for (let i = 0; i < lines.length - 1; i += 1) {
      if (/^(?:services?|услуг[аиеы]?)\s*[:：]?\s*$/i.test(lines[i]!)) {
        body = lines[i + 1] || "";
        fromNextLine = true;
        break;
      }
    }
  }
  if (!body) return [];

  // Next-line after bare «Услуги» is often a Maps category chip, not a list.
  if (fromNextLine && !/[,;]/.test(body) && !/\s(?:and|и)\s/i.test(body)) {
    return [];
  }

  const parts = body
    .split(/\s*(?:,|;|\band\b|\bи\b)\s*/i)
    .map((part) =>
      part
        .replace(/[\uE000-\uF8FF]/g, "")
        .replace(/[·•∙⋅]+/g, " ")
        .replace(/^[\s•·\-–—*]+/, "")
        .replace(/[.\s]+$/, "")
        .trim(),
    )
    .filter((part) => !isJunkServiceLabel(part));

  // Mostly chrome (RU Maps «Услуги: О нас, Поблизости, Понедельник…»).
  const rawParts = body
    .split(/\s*(?:,|;|\band\b|\bи\b)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const rawCount = rawParts.length;
  if (rawCount >= 4 && parts.length < Math.ceil(rawCount * 0.4)) {
    return [];
  }
  // City fragment left alone after street/ZIP were stripped from a Maps dump.
  if (
    rawCount >= 6 &&
    parts.length <= 2 &&
    parts.every((p) => /^[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё'’-]+$/.test(p))
  ) {
    return [];
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(part);
    if (out.length >= 24) break;
  }
  return out;
}

/** Strip URLs/phones/IG stats for a cleaner description candidate. */
export function extractDescriptionFromText(text: string): string | null {
  let cleaned = demathAlnum(text || "").trim();
  if (!cleaned) return null;
  // Rate / pricing tables are offers, not «О нас».
  if (looksLikeRateTable(cleaned)) return null;
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
  cleaned = cleaned.replace(
    /(?:^|\n)\s*(?:services?|услуг[аиеы]?)\s*[:：][^\n]*/gi,
    " ",
  );
  // Drop bare username-only / label-only lines
  cleaned = cleaned
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (DAY_LINE_RE.test(line)) return false;
      if (HOURS_RANGE_RE.test(line) && line.length < 40) return false;
      if (
        /^(blogger|creator|artist|personal\s*blog|book\s*now|my\s*website|website|facebook|instagram|links?|open\s*now|directions|overview|reviews|photos|products|about|suggest\s*new\s*hours|save|share|call)$/i.test(
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

/**
 * Yelp paste: «Yelp 4.1 (7 reviews)» / «Yelp 4.1 · 7 Reviews».
 */
export function extractYelpRatingFromText(
  text: string,
): { rating: number; reviewsCount: number } | null {
  const raw = demathAlnum(text || "");
  if (!raw.trim()) return null;

  const patterns: RegExp[] = [
    /\bYelp\s+([1-5](?:[.,]\d)?)\s*[·•.\-–—]?\s*\(?\s*(\d{1,6})\s*\)?\s*(?:Reviews?|отзыв(?:ов|а)?|ratings?)?\b/i,
    /\bYelp\b[^\n]{0,40}?\b([1-5](?:[.,]\d)?)\s*(?:\n|\r\n)+\s*\(?\s*(\d{1,6})\s*\)?\s*(?:Reviews?|отзыв(?:ов|а)?)?/i,
  ];

  for (const re of patterns) {
    const m = raw.match(re);
    if (!m) continue;
    const rating = Number(String(m[1]).replace(",", "."));
    const reviewsCount = Number(m[2]);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) continue;
    if (!Number.isFinite(reviewsCount) || reviewsCount < 1 || reviewsCount > 2_000_000) {
      continue;
    }
    return {
      rating: Math.round(rating * 10) / 10,
      reviewsCount: Math.floor(reviewsCount),
    };
  }
  return null;
}

/**
 * Trustpilot paste: «Trustpilot 3.7 (1 review)» / «TrustScore 3.7 · 16 Reviews».
 * Count optional when TrustScore / Trustpilot label is present.
 */
export function extractTrustpilotRatingFromText(
  text: string,
): { rating: number; reviewsCount: number } | null {
  const raw = demathAlnum(text || "");
  if (!raw.trim()) return null;

  const withCount: RegExp[] = [
    /\b(?:Trustpilot|TrustScore)\s+([1-5](?:[.,]\d)?)\s*(?:out\s+of\s+5)?\s*[·•.\-–—]?\s*\(?\s*(\d{1,6})\s*\)?\s*(?:Reviews?|отзыв(?:ов|а)?|ratings?)?\b/i,
    /\b(?:Trustpilot|TrustScore)\b[^\n]{0,40}?\b([1-5](?:[.,]\d)?)\s*(?:\n|\r\n)+\s*\(?\s*(\d{1,6})\s*\)?\s*(?:Reviews?|отзыв(?:ов|а)?)?/i,
  ];
  for (const re of withCount) {
    const m = raw.match(re);
    if (!m) continue;
    const rating = Number(String(m[1]).replace(",", "."));
    const reviewsCount = Number(m[2]);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) continue;
    if (
      !Number.isFinite(reviewsCount) ||
      reviewsCount < 0 ||
      reviewsCount > 2_000_000
    ) {
      continue;
    }
    return {
      rating: Math.round(rating * 10) / 10,
      reviewsCount: Math.floor(reviewsCount),
    };
  }

  const scoreOnly = raw.match(
    /\b(?:Trustpilot|TrustScore)\s+([1-5](?:[.,]\d)?)\s*(?:out\s+of\s+5)?\b/i,
  );
  if (scoreOnly) {
    const rating = Number(String(scoreOnly[1]).replace(",", "."));
    if (Number.isFinite(rating) && rating >= 1 && rating <= 5) {
      return { rating: Math.round(rating * 10) / 10, reviewsCount: 0 };
    }
  }
  return null;
}

/**
 * Facebook page paste: «100% recommend (24 Reviews)» / «100% рекомендуют (24 отзыва)».
 * Also «Recommended by 24 people».
 */
export function extractFacebookRecommendFromText(
  text: string,
): { recommendPct: number; reviewsCount: number } | null {
  const raw = demathAlnum(text || "");
  if (!raw.trim()) return null;

  const pctPatterns: RegExp[] = [
    /(\d{1,3})\s*%\s*(?:recommend(?:ed)?|рекоменд[а-яё]*)\s*\(?\s*(\d{1,7})\s*\)?\s*(?:Reviews?|отзыв(?:ов|а)?|people|человек[а-яё]*|чел\.?)?/iu,
    /(\d{1,3})\s*%\s*(?:recommend(?:ed)?|рекоменд[а-яё]*)\b/iu,
  ];
  for (const re of pctPatterns) {
    const m = raw.match(re);
    if (!m) continue;
    const pct = Number(m[1]);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) continue;
    const countRaw = m[2] != null ? Number(String(m[2]).replace(/[^\d]/g, "")) : 0;
    const reviewsCount =
      Number.isFinite(countRaw) && countRaw >= 0 && countRaw <= 2_000_000
        ? Math.floor(countRaw)
        : 0;
    return { recommendPct: Math.round(pct), reviewsCount };
  }

  const byPeople = raw.match(
    /\bRecommended\s+by\s+(\d{1,7})\s+(?:people|person|friends?)\b/i,
  );
  if (byPeople) {
    const reviewsCount = Number(byPeople[1]);
    if (
      Number.isFinite(reviewsCount) &&
      reviewsCount >= 1 &&
      reviewsCount <= 2_000_000
    ) {
      return { recommendPct: 100, reviewsCount: Math.floor(reviewsCount) };
    }
  }
  return null;
}

/** Review count token: `1724`, `1,724`, `1 724` (Maps often uses thousands commas). */
const REVIEW_COUNT_TOKEN = String.raw`(\d{1,3}(?:[,\u00a0\u202f ]\d{3})+|\d{1,7})`;

/** End of «Reviews» / «отзывов» — JS `\b` is ASCII-only and breaks after Cyrillic. */
const REVIEW_WORD = String.raw`(?:Reviews?|отзыв(?:ов|а)?|ratings?)(?=$|[^\p{L}\p{N}])`;

function parseReviewCountToken(raw: string): number | null {
  const n = Number(String(raw).replace(/[,\u00a0\u202f\s]/g, ""));
  if (!Number.isFinite(n) || n < 1 || n > 2_000_000) return null;
  return Math.floor(n);
}

/**
 * Google Maps paste: «4.7» then «(100)» / «100 Reviews» / «4.7 · 100 Reviews».
 * Returns null when the numbers are not a plausible Maps rating block.
 * Skips Yelp-labeled ratings («Yelp 4.1 (7 reviews)»).
 *
 * Never treat street numbers as stars: «4695 MacArthur» is not «4.0 (695)».
 */
export function extractGoogleRatingFromText(
  text: string,
): { rating: number; reviewsCount: number } | null {
  const raw = demathAlnum(text || "")
    // Do not treat Yelp / Trustpilot stars as Google stars.
    .replace(
      /\bYelp\s+[1-5](?:[.,]\d)?\s*[·•.\-–—]?\s*\(?\s*[\d,\u00a0\u202f ]{1,12}\s*\)?\s*(?:Reviews?|отзыв(?:ов|а)?|ratings?)?/gi,
      " ",
    )
    .replace(
      /\b(?:Trustpilot|TrustScore)\s+[1-5](?:[.,]\d)?(?:\s*out\s*of\s*5)?\s*[·•.\-–—]?\s*\(?\s*[\d,\u00a0\u202f ]{0,12}\s*\)?\s*(?:Reviews?|отзыв(?:ов|а)?|ratings?)?/gi,
      " ",
    );
  if (!raw.trim()) return null;

  const patterns: RegExp[] = [
    // 4.7 · 100 Reviews  /  4.7 (1,724 отзывов) — review word on same run.
    // Do not use ASCII `.` as a separator — it steals the decimal from «4.5258».
    new RegExp(
      String.raw`\b([1-5](?:[.,]\d)?)(?!\d)\s*[·•\-–—]?\s*\(?\s*${REVIEW_COUNT_TOKEN}\s*\)?\s*${REVIEW_WORD}`,
      "iu",
    ),
    // Maps block: 4.9\n(1,724) or 5.0\n(9) — decimal stars + parenthesized count
    new RegExp(
      String.raw`\b([1-5][.,]\d)(?!\d)\s*(?:\n|\r\n)+\s*[·•]?\s*\(\s*${REVIEW_COUNT_TOKEN}\s*\)`,
      "i",
    ),
    // 4.7\n·\n183 Reviews (middle dot on its own line)
    new RegExp(
      String.raw`\b([1-5](?:[.,]\d)?)(?!\d)\s*(?:\n|\r\n)+\s*[·•]\s*(?:\n|\r\n)+\s*${REVIEW_COUNT_TOKEN}\s*${REVIEW_WORD}`,
      "iu",
    ),
    // RU Maps: 4.5\n258 отзывов / 4.5\n258 отзывов Google (count not parenthesized)
    new RegExp(
      String.raw`\b([1-5](?:[.,]\d)?)(?!\d)\s*(?:\n|\r\n)+\s*${REVIEW_COUNT_TOKEN}\s*${REVIEW_WORD}`,
      "iu",
    ),
  ];

  for (const re of patterns) {
    const m = raw.match(re);
    if (!m) continue;
    const ratingToken = m[1]!;
    const rating = Number(String(ratingToken).replace(",", "."));
    const reviewsCount = parseReviewCountToken(m[2]!);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) continue;
    if (reviewsCount == null) continue;
    // Bare integers without «Reviews» are street/suite noise, not star ratings.
    if (
      rating === Math.floor(rating) &&
      !/[.,]/.test(ratingToken) &&
      reviewsCount < 3
    ) {
      continue;
    }
    return {
      rating: Math.round(rating * 10) / 10,
      reviewsCount,
    };
  }

  // Glued OCR / bad prior title: «4.5258 отзывов Google» → 4.5 + 258
  const glued = raw.match(
    new RegExp(
      String.raw`\b([1-5])[.,](\d)(\d{2,7})\s*${REVIEW_WORD}`,
      "iu",
    ),
  );
  if (glued) {
    const rating = Number(`${glued[1]}.${glued[2]}`);
    const reviewsCount = parseReviewCountToken(glued[3]!);
    if (
      Number.isFinite(rating) &&
      rating >= 1 &&
      rating <= 5 &&
      reviewsCount != null
    ) {
      return {
        rating: Math.round(rating * 10) / 10,
        reviewsCount,
      };
    }
  }

  return null;
}

export function parsePasteEnrichText(text: string): PasteEnrichExtracted {
  const normalized = demathAlnum(text || "");
  const phones = extractPhonesFromText(normalized);
  const emails = extractEmailsFromText(normalized);
  const facebook = extractFacebookFromText(normalized);
  const youtube = extractYouTubeFromText(normalized);
  const whatsapp = extractWhatsAppFromText(normalized);
  const yelp = extractYelpFromText(normalized);
  const trustpilot = extractTrustpilotFromText(normalized);
  const googleMaps = extractGoogleMapsFromText(normalized);
  const websites = extractWebsitesFromText(normalized);
  const instagram = extractInstagramFromText(normalized);
  const tgs = extractTelegramFromText(normalized);
  const street = extractUsStreetAddress(normalized);
  const place = extractPlaceFromText(normalized);
  const description = extractDescriptionFromText(text);
  const openingHours = extractOpeningHoursFromText(text);
  const yelpStars = extractYelpRatingFromText(text);
  const trustpilotStars = extractTrustpilotRatingFromText(text);
  const google = extractGoogleRatingFromText(text);
  const facebookRec = extractFacebookRecommendFromText(text);
  const menuItems = looksLikeMenuDocument(text) ? parseMenuFromText(text) : [];
  const pricedServices =
    menuItems.length >= 3 ? [] : extractPricedServicesFromText(text);
  const services =
    menuItems.length >= 3
      ? []
      : pricedServices.length >= 2
        ? pricedServices.map((p) => p.title)
        : extractServicesFromText(text);
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
    youtube,
    whatsapp,
    yelp,
    trustpilot,
    googleMaps,
    googleRating: google?.rating ?? null,
    googleReviewsCount: google?.reviewsCount ?? null,
    yelpRating: yelpStars?.rating ?? null,
    yelpReviewsCount: yelpStars?.reviewsCount ?? null,
    trustpilotRating: trustpilotStars?.rating ?? null,
    trustpilotReviewsCount: trustpilotStars?.reviewsCount ?? null,
    facebookRecommendPct: facebookRec?.recommendPct ?? null,
    facebookReviewsCount: facebookRec?.reviewsCount ?? null,
    city: street.city || place.city,
    state: street.state || place.state,
    addressLine: street.addressLine,
    postalCode: street.postalCode,
    description,
    openingHours,
    services,
    pricedServices,
    menuItems,
  };
}

/**
 * Build preview rows: what will be added vs skipped (fill-empty).
 * `hasPhotoFile` — user attached an image in the modal.
 * `addressGeo` — after «Разобрать» geocode gate for street pin.
 */
export function buildPasteEnrichPreview(
  existing: PasteEnrichExisting,
  extracted: PasteEnrichExtracted,
  hasPhotoFile: boolean,
  addressGeo?: PasteAddressGeoGate | null,
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

  if (extracted.googleRating != null) {
    const count = extracted.googleReviewsCount ?? 0;
    const emptyRating =
      existing.googleRating == null ||
      !Number.isFinite(Number(existing.googleRating)) ||
      Number(existing.googleRating) <= 0;
    rows.push({
      key: "googleRating",
      label: FIELD_LABELS.googleRating,
      value: count > 0 ? `${extracted.googleRating} (${count})` : String(extracted.googleRating),
      action: emptyRating ? "add" : "skip",
    });
  }

  if (extracted.yelpRating != null) {
    const count = extracted.yelpReviewsCount ?? 0;
    const emptyRating =
      existing.yelpRating == null ||
      !Number.isFinite(Number(existing.yelpRating)) ||
      Number(existing.yelpRating) <= 0;
    rows.push({
      key: "yelpRating",
      label: FIELD_LABELS.yelpRating,
      value: count > 0 ? `${extracted.yelpRating} (${count})` : String(extracted.yelpRating),
      action: emptyRating ? "add" : "skip",
    });
  }

  if (extracted.trustpilotRating != null) {
    const count = extracted.trustpilotReviewsCount ?? 0;
    const emptyRating =
      existing.trustpilotRating == null ||
      !Number.isFinite(Number(existing.trustpilotRating)) ||
      Number(existing.trustpilotRating) <= 0;
    rows.push({
      key: "trustpilotRating",
      label: FIELD_LABELS.trustpilotRating,
      value:
        count > 0
          ? `${extracted.trustpilotRating} (${count})`
          : String(extracted.trustpilotRating),
      action: emptyRating ? "add" : "skip",
    });
  }

  if (extracted.facebookRecommendPct != null) {
    const count = extracted.facebookReviewsCount ?? 0;
    const emptyRec =
      existing.facebookRecommendPct == null ||
      !Number.isFinite(Number(existing.facebookRecommendPct)) ||
      Number(existing.facebookRecommendPct) <= 0;
    rows.push({
      key: "facebookRecommend",
      label: FIELD_LABELS.facebookRecommend,
      value:
        count > 0
          ? `${extracted.facebookRecommendPct}% · ${count} отзывов`
          : `${extracted.facebookRecommendPct}%`,
      action: emptyRec ? "add" : "skip",
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

  if (extracted.youtube) {
    rows.push({
      key: "youtube",
      label: FIELD_LABELS.youtube,
      value: extracted.youtube,
      action: emptyScalar(existing.youtube) ? "add" : "skip",
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

  if (extracted.yelp) {
    rows.push({
      key: "yelp",
      label: FIELD_LABELS.yelp,
      value: extracted.yelp,
      action: emptyScalar(existing.yelp) ? "add" : "skip",
    });
  }

  if (extracted.trustpilot) {
    rows.push({
      key: "trustpilot",
      label: FIELD_LABELS.trustpilot,
      value: extracted.trustpilot,
      action: emptyScalar(existing.trustpilot) ? "add" : "skip",
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

  const streetsDiffer =
    Boolean(extracted.addressLine) &&
    preferWebsiteStreet(existing.addressLine, extracted.addressLine);
  const addressAction: "add" | "skip" | "replace" = extracted.addressLine
    ? addressGeo
      ? pasteAddressPreviewAction({
          existingEmpty: emptyScalar(existing.addressLine),
          streetsDiffer,
          pastedPins: addressGeo.pastedPins,
          cardPins: addressGeo.cardPins,
        })
      : emptyScalar(existing.addressLine)
        ? "add"
        : streetsDiffer
          ? "replace"
          : "skip"
    : "skip";
  const addressHint =
    extracted.addressLine && addressGeo
      ? !addressGeo.pastedPins
        ? "не нашёлся на карте"
        : addressAction === "replace" && !addressGeo.cardPins
          ? "на карте найдётся · сейчас пина нет"
          : null
      : null;

  /** City / state / ZIP follow the address gate when we have a street. */
  function placeCompanionAction(
    existingVal: string | null | undefined,
    incoming: string,
    same: (a: string, b: string) => boolean,
  ): "add" | "skip" | "replace" {
    if (extracted.addressLine && addressGeo && !addressGeo.pastedPins) {
      return "skip";
    }
    if (extracted.addressLine && addressAction === "add") {
      return emptyScalar(existingVal) ? "add" : "skip";
    }
    if (extracted.addressLine && addressAction === "replace") {
      if (emptyScalar(existingVal)) return "add";
      return same(String(existingVal), incoming) ? "skip" : "replace";
    }
    // No geo gate / no street — classic fill-empty / differ.
    let action = scalarPreviewAction(existingVal, incoming, same);
    if (
      action === "skip" &&
      streetsDiffer &&
      !emptyScalar(existingVal) &&
      !same(String(existingVal), incoming)
    ) {
      action = "replace";
    }
    return action;
  }

  if (extracted.city) {
    const action = placeCompanionAction(
      existing.city,
      extracted.city,
      (a, b) => normPlace(a) === normPlace(b),
    );
    rows.push({
      key: "city",
      label: FIELD_LABELS.city,
      value: extracted.city,
      action,
      currentValue: action === "replace" ? existing.city : null,
    });
  }

  if (extracted.state) {
    const action = placeCompanionAction(
      existing.state,
      extracted.state,
      (a, b) => normPlace(a) === normPlace(b),
    );
    rows.push({
      key: "state",
      label: FIELD_LABELS.state,
      value: extracted.state,
      action,
      currentValue: action === "replace" ? existing.state : null,
    });
  }

  if (extracted.addressLine) {
    rows.push({
      key: "address",
      label: FIELD_LABELS.address,
      value: extracted.addressLine,
      action: addressAction,
      currentValue:
        addressAction === "replace" ? existing.addressLine : null,
      hint: addressHint,
    });
  }

  if (extracted.postalCode) {
    const action = placeCompanionAction(
      existing.postalCode,
      extracted.postalCode,
      (a, b) => normZip(a) === normZip(b),
    );
    rows.push({
      key: "postal",
      label: FIELD_LABELS.postal,
      value: extracted.postalCode,
      action,
      currentValue: action === "replace" ? existing.postalCode : null,
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

  if (extracted.services.length > 0 || (extracted.pricedServices?.length ?? 0) > 0) {
    const existingKeys = new Set(
      (existing.services ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean),
    );
    const priced = extracted.pricedServices ?? [];
    const novelPriced = priced.filter(
      (p) => !existingKeys.has(p.title.trim().toLowerCase()),
    );
    const novelNames = extracted.services.filter(
      (s) => !existingKeys.has(s.trim().toLowerCase()),
    );
    if (novelPriced.length > 0) {
      const preview = novelPriced.slice(0, 4).map((p) => {
        const unit = p.perHour ? "/час" : "";
        return `${p.title} $${p.priceAmount}${unit}`;
      });
      const display =
        novelPriced.length <= 4
          ? preview.join(", ")
          : `${preview.join(", ")}… (+${novelPriced.length - 4})`;
      rows.push({
        key: "services",
        label: FIELD_LABELS.services,
        value: display,
        action: "add",
      });
    } else if (novelNames.length > 0) {
      const display =
        novelNames.length <= 4
          ? novelNames.join(", ")
          : `${novelNames.slice(0, 4).join(", ")}… (+${novelNames.length - 4})`;
      rows.push({
        key: "services",
        label: FIELD_LABELS.services,
        value: display,
        action: "add",
      });
    }
  }

  if ((extracted.menuItems ?? []).length > 0) {
    const existingKeys = new Set(
      (existing.services ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean),
    );
    const novel = extracted.menuItems.filter(
      (m) => !existingKeys.has(m.title.trim().toLowerCase()),
    );
    if (novel.length > 0) {
      const preview = novel
        .slice(0, 4)
        .map((m) =>
          m.priceAmount != null ? `${m.title} $${m.priceAmount}` : m.title,
        );
      const display =
        novel.length <= 4
          ? preview.join(", ")
          : `${preview.join(", ")}… (+${novel.length - 4})`;
      rows.push({
        key: "menu",
        label: FIELD_LABELS.menu,
        value: display,
        action: "add",
      });
    }
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

/** Patch object with only fill-empty fields from extracted (+ optional image URL).
 *
 * `applyReplaceKeys` — which «replace» location fields the admin confirmed.
 * `null`/`undefined` = apply every automatic street rewrite (preferWebsiteStreet).
 * `[]` = skip replaces (fill-empty only).
 */
export function pasteEnrichFillEmptyPatch(
  existing: PasteEnrichExisting,
  extracted: PasteEnrichExtracted,
  imageUrl: string | null,
  opts?: { applyReplaceKeys?: readonly PasteEnrichFieldKey[] | null },
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const replaceKeys = opts?.applyReplaceKeys;
  const allowReplace = (key: PasteEnrichFieldKey) =>
    replaceKeys == null || replaceKeys.includes(key);

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
  if (emptyScalar(existing.youtube) && extracted.youtube) {
    patch.youtube = extracted.youtube;
  }
  if (emptyList(existing.whatsapp) && extracted.whatsapp) {
    patch.whatsapp = extracted.whatsapp;
  }
  if (emptyScalar(existing.yelp) && extracted.yelp) {
    patch.yelp = extracted.yelp;
  }
  if (emptyScalar(existing.trustpilot) && extracted.trustpilot) {
    patch.trustpilot = extracted.trustpilot;
  }
  if (emptyScalar(existing.googleMaps) && extracted.googleMaps) {
    patch.googleMaps = extracted.googleMaps;
  }
  const emptyGoogleRating =
    existing.googleRating == null ||
    !Number.isFinite(Number(existing.googleRating)) ||
    Number(existing.googleRating) <= 0;
  if (emptyGoogleRating && extracted.googleRating != null) {
    patch.googleRating = extracted.googleRating;
    if (extracted.googleReviewsCount != null && extracted.googleReviewsCount > 0) {
      patch.googleReviewsCount = extracted.googleReviewsCount;
    }
  }
  const emptyYelpRating =
    existing.yelpRating == null ||
    !Number.isFinite(Number(existing.yelpRating)) ||
    Number(existing.yelpRating) <= 0;
  if (emptyYelpRating && extracted.yelpRating != null) {
    patch.yelpRating = extracted.yelpRating;
    if (extracted.yelpReviewsCount != null && extracted.yelpReviewsCount > 0) {
      patch.yelpReviewsCount = extracted.yelpReviewsCount;
    }
  }
  const emptyTrustpilotRating =
    existing.trustpilotRating == null ||
    !Number.isFinite(Number(existing.trustpilotRating)) ||
    Number(existing.trustpilotRating) <= 0;
  if (emptyTrustpilotRating && extracted.trustpilotRating != null) {
    patch.trustpilotRating = extracted.trustpilotRating;
    if (
      extracted.trustpilotReviewsCount != null &&
      extracted.trustpilotReviewsCount > 0
    ) {
      patch.trustpilotReviewsCount = extracted.trustpilotReviewsCount;
    }
  }
  const emptyFacebookRec =
    existing.facebookRecommendPct == null ||
    !Number.isFinite(Number(existing.facebookRecommendPct)) ||
    Number(existing.facebookRecommendPct) <= 0;
  if (emptyFacebookRec && extracted.facebookRecommendPct != null) {
    patch.facebookRecommendPct = extracted.facebookRecommendPct;
    if (
      extracted.facebookReviewsCount != null &&
      extracted.facebookReviewsCount > 0
    ) {
      patch.facebookReviewsCount = extracted.facebookReviewsCount;
    }
  }
  if (emptyScalar(existing.city) && extracted.city) {
    patch.city = extracted.city;
  }
  if (emptyScalar(existing.state) && extracted.state) {
    patch.state = extracted.state;
  }
  const takeAddress =
    Boolean(extracted.addressLine) &&
    (emptyScalar(existing.addressLine) ||
      // Explicit checkbox: take even when street text is “the same” (pin refresh).
      (allowReplace("address") &&
        (replaceKeys != null ||
          preferWebsiteStreet(existing.addressLine, extracted.addressLine))));
  if (takeAddress) {
    patch.addressLine = extracted.addressLine;
    // City/ZIP often name the old venue — refresh with the paste when present.
    if (extracted.city) patch.city = extracted.city;
    if (extracted.state) patch.state = extracted.state;
    if (extracted.postalCode) patch.postalCode = extracted.postalCode;
  } else {
    if (
      allowReplace("city") &&
      extracted.city &&
      !emptyScalar(existing.city) &&
      normPlace(existing.city) !== normPlace(extracted.city)
    ) {
      patch.city = extracted.city;
    }
    if (
      allowReplace("state") &&
      extracted.state &&
      !emptyScalar(existing.state) &&
      normPlace(existing.state) !== normPlace(extracted.state)
    ) {
      patch.state = extracted.state;
    }
    if (
      allowReplace("postal") &&
      extracted.postalCode &&
      !emptyScalar(existing.postalCode) &&
      normZip(existing.postalCode) !== normZip(extracted.postalCode)
    ) {
      patch.postalCode = extracted.postalCode;
    } else if (emptyScalar(existing.postalCode) && extracted.postalCode) {
      patch.postalCode = extracted.postalCode;
    }
  }
  if (emptyOpeningHours(existing.openingHours) && extracted.openingHours) {
    patch.openingHours = extracted.openingHours;
  }
  if (extracted.services.length > 0 || (extracted.pricedServices?.length ?? 0) > 0) {
    const existingKeys = new Set(
      (existing.services ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean),
    );
    const fromPriced = (extracted.pricedServices ?? []).map((p) => p.title);
    const novel = [...fromPriced, ...extracted.services].filter((s) => {
      const key = s.trim().toLowerCase();
      if (!key || existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });
    if (novel.length > 0) {
      // Queue: full merged list. Live apply uses this as the novel-only list.
      const merged = [...(existing.services ?? []).filter(Boolean), ...novel];
      patch.services = emptyList(existing.services) ? novel : merged;
    }
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
