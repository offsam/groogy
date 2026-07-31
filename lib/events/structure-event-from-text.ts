/**
 * Split messy event / affiche posts into structured fields.
 * Contacts, when, where, price → dedicated slots; description stays narrative.
 * Shared by Approve + (mirrors Python enrich step for events).
 */

import {
  demathAlnum,
  extractEmailsFromText,
  extractInstagramFromText,
  extractPhonesFromText,
  extractWebsitesFromText,
} from "@/lib/admin/paste-enrich";
import { redactContactsFromPublicText } from "@/lib/content/structure-business-profile";

/** One dated session of an affiche — every date becomes its own public event. */
export type EventOccurrence = {
  label: string;
  /** ISO timestamptz when the day is parseable. */
  startsAt: string | null;
};

export type StructuredEventFromText = {
  eventAtLabel: string | null;
  /** ISO timestamptz when day is parseable; time may be noon UTC fallback. */
  startsAt: string | null;
  /** Every distinct date in the post. One event per entry. */
  occurrences: EventOccurrence[];
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  priceLabel: string | null;
  priceAmount: number | null;
  /** Canonical payment methods: PayPal, Venmo, Cash, … */
  paymentMethods: string[];
  phone: string | null;
  registrationUrl: string | null;
  website: string[];
  instagram: string[];
  email: string[];
  /** Narrative without when/where/price/contact meta lines. */
  description: string | null;
  /** True when date came from an explicit «Когда:» / When: label. */
  dateFromLabeledField: boolean;
};

const MONTHS_RU: Record<string, number> = {
  январ: 1,
  феврал: 2,
  март: 3,
  апрел: 4,
  мая: 5,
  май: 5,
  июн: 6,
  июл: 7,
  август: 8,
  сентябр: 9,
  октябр: 10,
  ноябр: 11,
  декабр: 12,
};

const META_LINE_RE =
  /^(?:когда|when|где|where|адрес|address|билеты?|tickets?|цена|price|стоимость|как\s+записаться|как\s+оплатить|оплат[аы]|контакты?|contacts?|телефон|phone|форма|form|регистрац|registration|возраст|age|продолжительность|duration|тема|theme)\b/i;

const CAMERA_IG_RE = /(?:📷|📸)\s*@?([A-Za-z0-9._]{2,30})\b/g;

/** Known payment methods → public label. Order = display preference. */
const PAYMENT_METHOD_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bpay\s*pal\b|\bpaypal\b|пейпал/i, label: "PayPal" },
  { re: /\bvenmo\b|вемо/i, label: "Venmo" },
  { re: /\bzelle\b|зелл/i, label: "Zelle" },
  { re: /\bcash\s*app\b|\bcashapp\b/i, label: "Cash App" },
  { re: /\bapple\s*pay\b/i, label: "Apple Pay" },
  { re: /\bgoogle\s*pay\b|\bg\s*pay\b/i, label: "Google Pay" },
  { re: /\bvisa\b/i, label: "Visa" },
  {
    re: /\bmastercard\b|\bmaster\s*card\b|мастер\s*кард/i,
    label: "Mastercard",
  },
  {
    re: /\b(?:credit\s*|debit\s*)?cards?\b|\bкарт(?:а|ой|ы|у)\b/i,
    label: "Карта",
  },
  { re: /\bcash\b|\bналичн\w*\b|\bкэш\b/i, label: "Cash" },
  { re: /\bcheck\b|\bcheque\b|\bчек\b/i, label: "Check" },
];

function parsePaymentMethods(text: string): string[] {
  const labeled =
    labeledValue(text, [
      "Как оплатить",
      "Оплата",
      "Payment",
      "Payments",
      "Pay with",
      "Способ оплаты",
      "Способы оплаты",
    ]) || "";
  // Prefer the labeled line; also scan whole text for known tokens.
  const hay = `${labeled}\n${text}`;
  const found: string[] = [];
  for (const { re, label } of PAYMENT_METHOD_PATTERNS) {
    if (re.test(hay) && !found.includes(label)) found.push(label);
  }
  // If we only found methods inside an unrelated context with no payment
  // signal at all, still keep them — event posts mentioning PayPal/Venmo
  // almost always mean payment.
  return found;
}

function monthFromRuToken(token: string): number | null {
  const t = token.toLowerCase();
  for (const [prefix, num] of Object.entries(MONTHS_RU)) {
    if (t.startsWith(prefix)) return num;
  }
  return null;
}

function labeledValue(text: string, labels: string[]): string | null {
  const re = new RegExp(
    `(?:^|\\n)\\s*(?:${labels.map((l) => l.replace(/\s+/g, "\\s+")).join("|")})\\s*[:：]\\s*(.+)`,
    "im",
  );
  const m = text.match(re);
  return m?.[1]?.trim() || null;
}

function parseEventAtLabel(label: string): {
  label: string;
  startsAt: string | null;
} {
  const cleaned = label.replace(/\s+/g, " ").trim();
  const yearM = cleaned.match(/\b(20\d{2})\b/);
  const year = yearM ? Number(yearM[1]) : new Date().getFullYear();

  let month: number | null = null;
  let day: number | null = null;

  const ru = cleaned.match(
    /(\d{1,2})\s+([а-яё]+)/i,
  );
  if (ru) {
    day = Number(ru[1]);
    month = monthFromRuToken(ru[2] || "");
  }

  if (month == null || day == null) {
    const en = cleaned.match(
      /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})\b/i,
    );
    if (en) {
      const names: Record<string, number> = {
        january: 1,
        february: 2,
        march: 3,
        april: 4,
        may: 5,
        june: 6,
        july: 7,
        august: 8,
        september: 9,
        october: 10,
        november: 11,
        december: 12,
      };
      month = names[en[1]!.toLowerCase()] ?? null;
      day = Number(en[2]);
    }
  }

  if (month == null || day == null) {
    const md = cleaned.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (md) {
      month = Number(md[1]);
      day = Number(md[2]);
      if (month > 12) {
        const swap = month;
        month = day;
        day = swap;
      }
    }
  }

  let hour = 12;
  let minute = 0;
  const ampm = cleaned.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (ampm) {
    hour = Number(ampm[1]);
    minute = ampm[2] ? Number(ampm[2]) : 0;
    const ap = ampm[3]!.toLowerCase();
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
  } else {
    const h24 = cleaned.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (h24) {
      hour = Number(h24[1]);
      minute = Number(h24[2]);
    }
  }

  if (month == null || day == null || !Number.isFinite(year)) {
    return { label: cleaned, startsAt: null };
  }

  // America/Los_Angeles offset approximation for CA events (−08 / −07).
  // Store as UTC noon-local-ish via fixed −08 for stability without luxon.
  const pad = (n: number) => String(n).padStart(2, "0");
  const localIso = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00-08:00`;
  const dt = new Date(localIso);
  if (Number.isNaN(dt.getTime())) {
    return { label: cleaned, startsAt: null };
  }
  return { label: cleaned, startsAt: dt.toISOString() };
}

/**
 * Ru month words in the forms actually used in affiche posts.
 * `\b` cannot close a Cyrillic word in JS regex, so the tail uses a lookahead.
 */
const RU_MONTH_WORD_RE =
  /\b(\d{1,2})\s+(январ[ья]|феврал[ья]|марта?|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|августа?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])(?![а-яё])/gi;

const EN_MONTH_WORD_RE =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})\b/gi;

const NUMERIC_DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;

function lineHasDate(line: string): boolean {
  RU_MONTH_WORD_RE.lastIndex = 0;
  EN_MONTH_WORD_RE.lastIndex = 0;
  NUMERIC_DATE_RE.lastIndex = 0;
  return (
    RU_MONTH_WORD_RE.test(line) ||
    EN_MONTH_WORD_RE.test(line) ||
    NUMERIC_DATE_RE.test(line)
  );
}

function dayKey(startsAt: string | null): string | null {
  if (!startsAt) return null;
  const d = new Date(startsAt);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Split a date line that lists several days («1 и 4 апреля», «3, 10 мая»)
 * into per-day fragments, each inheriting the month from the line.
 */
function splitMultiDayLine(line: string): string[] {
  RU_MONTH_WORD_RE.lastIndex = 0;
  const monthMatch = RU_MONTH_WORD_RE.exec(line);
  if (!monthMatch) return [line];
  const month = monthMatch[2]!;
  const head = line.slice(0, monthMatch.index);
  const days = [...head.matchAll(/\b(\d{1,2})\b(?=\s*(?:,|;|\sи\s|\/|\s*$))/gi)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 1 && n <= 31);
  if (!days.length) return [line];
  const tail = line.slice(monthMatch.index + monthMatch[0].length);
  return [...days, Number(monthMatch[1])].map(
    (day) => `${day} ${month}${tail}`,
  );
}

/**
 * Every date mentioned in the post, in reading order.
 * An affiche with «1 апреля – 10:30 AM» + «4 апреля – 12:30 PM» yields two.
 */
export function parseEventOccurrences(text: string): EventOccurrence[] {
  const yearM = text.match(/\b(20\d{2})\b/);
  const yearHint = yearM ? ` ${yearM[1]}` : "";
  const out: EventOccurrence[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line || !lineHasDate(line)) continue;
    // Drop a leading «Когда:» / «When:» label but keep the value.
    const value = line.replace(
      /^(?:когда|when|date|дата)\s*[:：]\s*/i,
      "",
    );
    for (const fragment of splitMultiDayLine(value)) {
      const withYear = /\b20\d{2}\b/.test(fragment)
        ? fragment
        : `${fragment}${yearHint}`;
      const parsed = parseEventAtLabel(withYear);
      const key = dayKey(parsed.startsAt);
      if (!key) continue;
      const timeKey = `${key}T${new Date(parsed.startsAt!)
        .toISOString()
        .slice(11, 16)}`;
      if (seen.has(timeKey)) continue;
      seen.add(timeKey);
      out.push({ label: parseEventAtLabel(fragment).label, startsAt: parsed.startsAt });
    }
  }
  return out;
}

const EMOJI_PREFIX_RE =
  /^(?:[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{FE0F}\u{200D}]+\s*)+/u;
const RU_DATE_PREFIX_RE =
  /^\d{1,2}\s+(?:январ[ья]|феврал[ья]|марта?|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|августа?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])\s*[-–—:：,]?\s*/iu;
const EN_DATE_PREFIX_RE =
  /^(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\s*[-–—:：,]?\s*/i;
const NUMERIC_DATE_PREFIX_RE = /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s*[-–—:：,]?\s*/;

/** «💻 31 июля - Speed Dating…» → «Speed Dating…» for the public event title. */
export function titleFromOccurrenceLabel(
  label: string | null | undefined,
): string | null {
  let s = (label || "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  s = s.replace(EMOJI_PREFIX_RE, "").trim();
  s = s.replace(RU_DATE_PREFIX_RE, "");
  s = s.replace(EN_DATE_PREFIX_RE, "");
  s = s.replace(NUMERIC_DATE_PREFIX_RE, "");
  s = s.replace(/^[-–—:：,\s]+/, "").replace(/[:：]\s*$/, "").trim();
  const letters = (s.match(/\p{L}/gu) || []).length;
  if (letters < 6) return null;
  return s.slice(0, 120);
}

/** First usable session name from a multi-date affiche schedule. */
export function firstScheduleEventTitle(
  text: string | null | undefined,
): string | null {
  if (!text?.trim()) return null;
  for (const occ of parseEventOccurrences(demathAlnum(text))) {
    const title = titleFromOccurrenceLabel(occ.label);
    if (title) return title;
  }
  return null;
}

/** Day-level date keys (YYYY-MM-DD) of every session in the post. */
export function eventDayKeys(text: string | null | undefined): string[] {
  if (!text?.trim()) return [];
  const keys = new Set<string>();
  for (const occ of parseEventOccurrences(demathAlnum(text))) {
    const key = dayKey(occ.startsAt);
    if (key) keys.add(key);
  }
  return [...keys].sort();
}

function parseWhere(raw: string): {
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
} {
  const line = raw.replace(/\s+/g, " ").trim();
  const zipM = line.match(/\b(\d{5})(?:-\d{4})?\b/);
  const postalCode = zipM?.[1] ?? null;

  // «23 Spectrum Pointe dr, room 203, Lake Forest, 92630»
  const cityZip = line.match(
    /,\s*([A-Za-z][A-Za-z .'-]+?)\s*,\s*(?:CA|California)?\s*(\d{5})\b/i,
  );
  if (cityZip) {
    const city = cityZip[1]!.trim();
    const before = line.slice(0, cityZip.index).replace(/,\s*$/, "").trim();
    return {
      addressLine: before || line,
      city,
      postalCode: cityZip[2] || postalCode,
    };
  }

  const cityOnly = line.match(/,\s*([A-Za-z][A-Za-z .'-]+)\s*$/);
  return {
    addressLine: line,
    city: cityOnly?.[1]?.trim() || null,
    postalCode,
  };
}

function parsePrice(raw: string): { label: string; amount: number | null } {
  const label = raw.replace(/\s+/g, " ").trim().slice(0, 120);
  const m = label.match(/\$\s*(\d+(?:[.,]\d{1,2})?)/);
  if (m) {
    const amount = Number(m[1]!.replace(",", "."));
    return { label, amount: Number.isFinite(amount) ? amount : null };
  }
  if (/\bбесплатн|\bfree\b|\bno\s+charge\b/i.test(label)) {
    return { label: "Бесплатно", amount: 0 };
  }
  const rub = label.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:usd|доллар)/i);
  if (rub) {
    const amount = Number(rub[1]!.replace(",", "."));
    return { label, amount: Number.isFinite(amount) ? amount : null };
  }
  return { label, amount: null };
}

const PRICE_DOLLAR_RE =
  /(?:всего\s+за|за|от|стоимость|цена|билеты?|tickets?|price|cost|only)\s*\$\s*(\d+(?:[.,]\d{1,2})?)|\$\s*(\d+(?:[.,]\d{1,2})?)\s*(?:за|\/|за\s+кажд)/i;
/** Cyrillic-safe: JS \w / \b are ASCII-only and miss «Бесплатный». */
const FREE_EVENT_RE =
  /бесплатн|free\s+(?:event|entry|admission|online|speed)|\bfree\b|no\s+charge/i;

/** Labeled «Цена:» first; else free / `$20` in the body. */
function inferPrice(
  text: string,
  labeledRaw: string | null,
): { label: string; amount: number | null } | null {
  if (labeledRaw) return parsePrice(labeledRaw);
  if (FREE_EVENT_RE.test(text)) return { label: "Бесплатно", amount: 0 };
  const m = text.match(PRICE_DOLLAR_RE);
  if (m) {
    const amount = Number((m[1] || m[2] || "").replace(",", "."));
    if (!Number.isFinite(amount)) return null;
    return {
      label: m[0].replace(/\s+/g, " ").trim().slice(0, 120),
      amount,
    };
  }
  return null;
}

function preferRegistrationUrl(urls: string[]): string | null {
  const scored = [...urls].sort((a, b) => {
    const score = (u: string) => {
      const low = u.toLowerCase();
      if (low.includes("forms.gle") || low.includes("docs.google.com/forms"))
        return 0;
      if (low.includes("eventbrite") || low.includes("partiful")) return 1;
      if (low.includes("calendly")) return 2;
      return 5;
    };
    return score(a) - score(b);
  });
  return scored[0] ?? null;
}

function cleanEventDescription(text: string): string | null {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((line) => !META_LINE_RE.test(line))
    .filter((line) => !/^https?:\/\//i.test(line))
    .filter((line) => !/^(?:paypal|venmo|cash|зум|zoom)\b/i.test(line))
    .filter(
      (line) =>
        !/\bпосле\s+заполнения\s+формы\b/i.test(line) &&
        !/\bинформаци\w*\s+для\s+оплаты\b/i.test(line),
    )
    .filter((line) => {
      CAMERA_IG_RE.lastIndex = 0;
      if (!CAMERA_IG_RE.test(line)) return true;
      CAMERA_IG_RE.lastIndex = 0;
      return line.replace(CAMERA_IG_RE, "").trim().length > 8;
    });

  let joined = lines.join("\n");
  joined = redactContactsFromPublicText(joined) || "";
  joined = joined
    .replace(CAMERA_IG_RE, " ")
    .replace(/#\w+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return joined.length >= 12 ? joined.slice(0, 4000) : null;
}

/**
 * Parse an event post / queue description into structured affiche fields.
 */
export function structureEventFromText(
  raw: string | null | undefined,
): StructuredEventFromText {
  const empty: StructuredEventFromText = {
    eventAtLabel: null,
    startsAt: null,
    occurrences: [],
    addressLine: null,
    city: null,
    postalCode: null,
    priceLabel: null,
    priceAmount: null,
    paymentMethods: [],
    phone: null,
    registrationUrl: null,
    website: [],
    instagram: [],
    email: [],
    description: null,
    dateFromLabeledField: false,
  };
  if (!raw?.trim()) return empty;

  const text = demathAlnum(raw);

  const whenRaw =
    labeledValue(text, ["Когда", "When", "Date", "Дата"]) || null;
  const occurrences = parseEventOccurrences(text);
  let eventAtLabel: string | null = null;
  let startsAt: string | null = null;
  let dateFromLabeledField = false;
  if (whenRaw) {
    const parsed = parseEventAtLabel(whenRaw);
    eventAtLabel = parsed.label;
    startsAt = parsed.startsAt;
    dateFromLabeledField = Boolean(parsed.startsAt);
  } else if (occurrences.length) {
    eventAtLabel = occurrences[0]!.label;
    startsAt = occurrences[0]!.startsAt;
  }

  const whereRaw = labeledValue(text, ["Где", "Where", "Адрес", "Address"]);
  const where = whereRaw
    ? parseWhere(whereRaw)
    : { addressLine: null, city: null, postalCode: null };

  const priceRaw = labeledValue(text, [
    "Билеты",
    "Билет",
    "Tickets",
    "Ticket",
    "Цена",
    "Price",
    "Стоимость",
  ]);
  const price = inferPrice(text, priceRaw);
  const paymentMethods = parsePaymentMethods(text);

  const phones = extractPhonesFromText(text);
  const emails = extractEmailsFromText(text);
  const websites = extractWebsitesFromText(text);
  const ig = extractInstagramFromText(text);
  for (const m of text.matchAll(CAMERA_IG_RE)) {
    const h = (m[1] || "").toLowerCase();
    if (h && !ig.includes(h)) ig.push(h);
  }

  const registrationUrl = preferRegistrationUrl(websites);

  return {
    eventAtLabel,
    startsAt,
    occurrences,
    addressLine: where.addressLine,
    city: where.city,
    postalCode: where.postalCode,
    priceLabel: price?.label ?? null,
    priceAmount: price?.amount ?? null,
    paymentMethods,
    phone: phones[0] ?? null,
    registrationUrl,
    website: websites.slice(0, 3),
    instagram: ig.slice(0, 3),
    email: emails.slice(0, 3),
    description: cleanEventDescription(text),
    dateFromLabeledField,
  };
}

/** Fill-empty merge of structured event fields onto an import-review-like row. */
export function applyStructuredEventToQueueFields(
  existing: {
    phone?: string[] | null;
    email?: string[] | null;
    website?: string[] | null;
    instagram?: string[] | null;
    city?: string | null;
    address_line?: string | null;
    postal_code?: string | null;
    price?: number | null;
    description?: string | null;
    source_text?: string | null;
  },
  structured: StructuredEventFromText,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const emptyList = (v: string[] | null | undefined) =>
    !(v && v.filter((x) => x?.trim()).length);
  const emptyStr = (v: string | null | undefined) => !(v || "").trim();

  if (emptyList(existing.phone) && structured.phone) {
    patch.phone = [structured.phone];
  }
  if (emptyList(existing.email) && structured.email.length) {
    patch.email = structured.email;
  }
  if (emptyList(existing.website) && structured.website.length) {
    patch.website = structured.website;
  }
  if (emptyList(existing.instagram) && structured.instagram.length) {
    patch.instagram = structured.instagram;
  }
  if (emptyStr(existing.city) && structured.city) {
    patch.city = structured.city;
  }
  if (emptyStr(existing.address_line) && structured.addressLine) {
    patch.address_line = structured.addressLine;
  }
  if (emptyStr(existing.postal_code) && structured.postalCode) {
    patch.postal_code = structured.postalCode;
  }
  if (existing.price == null && structured.priceAmount != null) {
    patch.price = structured.priceAmount;
    patch.currency = "USD";
  }
  const desc = existing.description || existing.source_text;
  const descLooksLikeDump =
    emptyStr(existing.description) ||
    (desc &&
      (META_LINE_RE.test(desc) ||
        /Контакты\s*:/i.test(desc) ||
        /forms\.gle/i.test(desc)));
  if (descLooksLikeDump && structured.description) {
    patch.description = structured.description;
  }
  return patch;
}
