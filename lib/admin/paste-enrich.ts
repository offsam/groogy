/**
 * Admin paste-enrich: extract contacts/location/description from free text.
 * Fill-empty only — mirrors Python step_source_text (no LLM).
 */

export type PasteEnrichExisting = {
  /** Company name — only the import queue fills this. */
  name?: string | null;
  phone?: string | string[] | null;
  email?: string | string[] | null;
  website?: string | string[] | null;
  /** Handle, URL, or list — normalized for emptiness check. */
  instagram?: string | string[] | null;
  telegram?: string | null;
  city?: string | null;
  state?: string | null;
  addressLine?: string | null;
  postalCode?: string | null;
  description?: string | null;
  imageUrl?: string | null;
};

export type PasteEnrichExtracted = {
  /** Null unless the caller asked for name inference (import queue only). */
  name: string | null;
  phone: string[];
  email: string[];
  website: string[];
  instagram: string[];
  telegram: string | null;
  city: string | null;
  state: string | null;
  addressLine: string | null;
  postalCode: string | null;
  description: string | null;
};

export type PasteEnrichFieldKey =
  | "name"
  | "phone"
  | "email"
  | "website"
  | "instagram"
  | "telegram"
  | "city"
  | "state"
  | "address"
  | "postal"
  | "description"
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
  "tiktok.com",
  "youtube.com",
  "youtu.be",
];

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

/** US street + city + state + ZIP (e.g. Instagram bio footer). */
const US_STREET_ADDRESS_RE =
  /((?<![\d\-])\d{1,6}[ \t]+[A-Za-z0-9.'\-]+(?:[ \t]+[A-Za-z0-9.'\-]+){0,6}[ \t]+(?:Ave|Avenue|St|Street|Blvd|Boulevard|Rd|Road|Dr|Drive|Way|Ln|Lane|Ct|Court|Pl|Place|Hwy|Highway)\.?)\s*,\s*([A-Za-z][A-Za-z.\s]+?)\s*,\s*(?:([A-Z]{2})|California|CA|Washington|WA|New\s*York|NY|Florida|FL|Oregon|OR|Texas|TX)\s+(\d{5})(?:-\d{4})?/i;

const IG_STATS_LINE_RE =
  /^\s*\d[\d\s,.]*\s*(?:публикаци[йяе]|подписчик(?:ов)?|подписок|followers?|following|posts?).*$/gim;

const FIELD_LABELS: Record<PasteEnrichFieldKey, string> = {
  name: "Название",
  phone: "Телефон",
  email: "Email",
  website: "Сайт",
  instagram: "Instagram",
  telegram: "Telegram",
  city: "Город",
  state: "Штат",
  address: "Адрес",
  postal: "ZIP",
  description: "Описание",
  image: "Фото",
};

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
  return SOCIAL_HOST_MARKERS.some((m) => lower.includes(m));
}

function maskUrls(text: string): string {
  return text.replace(URL_SPAN_RE, (m) => " ".repeat(m.length));
}

function maskTelegramIds(text: string): string {
  return text.replace(TELEGRAM_ID_SPAN_RE, (m) => " ".repeat(m.length));
}

export function extractPhonesFromText(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const scrubbed = maskTelegramIds(maskUrls(text || ""));
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
  let cleaned = t
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
      if (
        /^(blogger|creator|artist|personal\s*blog|book\s*now|my\s*website|website|facebook|instagram|links?)$/i.test(
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
  const websites = extractWebsitesFromText(normalized);
  const instagram = extractInstagramFromText(normalized);
  const tgs = extractTelegramFromText(normalized);
  const street = extractUsStreetAddress(normalized);
  const place = extractPlaceFromText(normalized);
  const description = extractDescriptionFromText(text);
  return {
    name: null,
    phone: phones.slice(0, 3),
    email: emails.slice(0, 3),
    website: websites.slice(0, 3),
    instagram: instagram.slice(0, 3),
    telegram: tgs[0] ?? null,
    city: street.city || place.city,
    state: street.state || place.state,
    addressLine: street.addressLine,
    postalCode: street.postalCode,
    description,
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
