/**
 * Parse restaurant / cafe menu text into sectioned dishes with prices.
 * Used by paste-enrich (OCR) and published enrich (/menu HTML).
 */

export type ParsedMenuItem = {
  /** Menu section header, e.g. Breakfast, Salads. */
  section: string | null;
  title: string;
  description: string | null;
  priceAmount: number | null;
};

const PRICE_TAIL_RE =
  /(?:[-—–:·•]?\s*)?(?:\$|usd)?\s*(\d{1,3}(?:[.,]\d{2})?)\s*(?:\$|usd)?\s*$/i;

const PRICE_ONLY_RE = /^\$?\s*(\d{1,3}(?:[.,]\d{2})?)\s*\$?\s*$/i;

const SECTION_HINT_RE =
  /^(?:breakfast|brunch|lunch|dinner|salads?|soups?|appetizers?|starters?|entrees?|mains?|sides?|desserts?|drinks?|beverages?|coffee|tea|wine|beer|cocktails?|specials?|kids|children|традиционн|завтрак|обед|ужин|салат|суп|напитк|кофе|десерт|горяч|холодн)/i;

/** Google / Apple Maps chrome — never a dish or section. */
const NOISE_LINE_RE =
  /^(?:overview|reviews?|photos?|products?|directions|website|save|share|call|closed|open\s+now|google|maps?|menu|меню|about|nearby|services?|маршрут|обзор|отзыв\w*|фото|товары|о\s*нас|поблизости|сохранить|поделиться|позвонить|закрыто|открыто\s+сейчас|услуги|карта)\b/i;

/** Field labels + Maps status lines that paste dumps as fake «menu» rows. */
const MAPS_FIELD_OR_STATUS_RE =
  /^(?:адрес|address|телефон\w*|phone|часы(?:\s+работы)?|hours?(?:\s+of\s+operation)?|услуг[аиеы]?|services?|подтверждено\s+этим\s+бизнесом\b.*|confirmed\s+by\s+this\s+business\b.*|предложить\s+новые\s+часы(?:\s+работы)?|suggest\s+new\s+hours|send\s+to\s+phone|отправить\s+на\s+телефон|\d+(?:[.,]\d+)?\s*отзыв\w*(?:\s+google)?|\d+(?:[.,]\d+)?\s*\(\d[\d,]*(?:\s*reviews?)?\)|(?:\d[\d,]*)\s*отзыв\w*\s+google|(?:\d[\d,]*)\s*reviews?\b)/i;

const STREET_OR_PHONE_VALUE_RE =
  /^(?:\+?\(?\d[\d\s().\-]{7,}\d|\d{1,6}\s+\S+.*\b(?:st|str|street|ave|avenue|blvd|rd|road|dr|hwy|pkwy|ln|ct|pl|way|suite|ste|#)\b)/i;

function letterCount(value: string): number {
  return (value.match(/\p{L}/gu) || []).length;
}

function parsePrice(raw: string): number | null {
  const n = Number(String(raw).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > 500) return null;
  return Math.round(n * 100) / 100;
}

function cleanLine(raw: string): string {
  return raw
    .replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseSection(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return t;
  // Keep ALL-CAPS short headers readable: BREAKFAST → Breakfast
  if (t === t.toUpperCase() && letterCount(t) >= 3) {
    return t
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/\b(Hot|Iced|And|Of|The|With)\b/g, (w) => w.toLowerCase())
      .replace(/^(.)/, (c) => c.toUpperCase());
  }
  return t.slice(0, 80);
}

/** Section header: no price, short, ALL CAPS or known food section word. */
export function looksLikeMenuSection(line: string): boolean {
  const t = cleanLine(line);
  if (!t || t.length > 60) return false;
  if (PRICE_TAIL_RE.test(t) || PRICE_ONLY_RE.test(t)) return false;
  if (NOISE_LINE_RE.test(t) || MAPS_FIELD_OR_STATUS_RE.test(t)) return false;
  if (/^https?:\/\//i.test(t)) return false;
  const letters = letterCount(t);
  if (letters < 3) return false;
  if (SECTION_HINT_RE.test(t)) return true;
  // ALL CAPS heading (BREAKFAST, TRADITIONAL HOMEMADE FAVORITES).
  // Do NOT treat Title Case brand names («Lazy Tigers Truck Center») as
  // sections — Google Maps pastes use the business name as the first line.
  if (t === t.toUpperCase() && letters >= 4 && !/\d/.test(t)) return true;
  return false;
}

function isJunkMenuItemTitle(title: string): boolean {
  const t = cleanLine(title);
  if (!t || letterCount(t) < 2) return true;
  if (NOISE_LINE_RE.test(t) || MAPS_FIELD_OR_STATUS_RE.test(t)) return true;
  if (STREET_OR_PHONE_VALUE_RE.test(t)) return true;
  if (
    /^(?:пн|вт|ср|чт|пт|сб|вс|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)(?=$|[\s:,.0-9])/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/^услуг[аиеы]?\s*$/i.test(t)) return true;
  return false;
}

function splitTitleDescription(body: string): {
  title: string;
  description: string | null;
} {
  const t = body.trim();
  // «Olivier: Traditional potato salad…»
  const colon = t.match(/^([^:]{2,60}?)\s*:\s+(.+)$/);
  if (colon) {
    return {
      title: colon[1]!.trim().slice(0, 120),
      description: colon[2]!.trim().slice(0, 400) || null,
    };
  }
  // «Borscht — Traditional beet soup…» when em-dash separates name from blurb
  // (price already stripped). Prefer short left side as title.
  const dash = t.match(/^(.{2,50}?)\s+[—–-]\s+(.{8,})$/);
  if (dash && letterCount(dash[1]!) <= 40) {
    return {
      title: dash[1]!.trim().slice(0, 120),
      description: dash[2]!.trim().slice(0, 400) || null,
    };
  }
  return { title: t.slice(0, 120), description: null };
}

/**
 * Parse a pasted / OCR / website menu into dishes.
 * Ignores Google Maps chrome and contact lines.
 */
export function parseMenuFromText(
  text: string | null | undefined,
): ParsedMenuItem[] {
  const raw = String(text || "").trim();
  if (!raw) return [];

  const lines = raw
    .split(/\n+/)
    .map(cleanLine)
    .filter(
      (l) =>
        l.length > 0 &&
        !NOISE_LINE_RE.test(l) &&
        !MAPS_FIELD_OR_STATUS_RE.test(l) &&
        !STREET_OR_PHONE_VALUE_RE.test(l),
    );

  const items: ParsedMenuItem[] = [];
  let section: string | null = null;
  let pendingTitle: string | null = null;
  let pendingDesc: string | null = null;

  const flushPending = () => {
    if (!pendingTitle) return;
    const { title, description } = splitTitleDescription(
      pendingDesc ? `${pendingTitle}: ${pendingDesc}` : pendingTitle,
    );
    if (letterCount(title) >= 2 && !isJunkMenuItemTitle(title)) {
      items.push({
        section,
        title,
        description: description || pendingDesc,
        priceAmount: null,
      });
    }
    pendingTitle = null;
    pendingDesc = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;

    if (looksLikeMenuSection(line)) {
      flushPending();
      section = titleCaseSection(line);
      continue;
    }

    const priceOnly = line.match(PRICE_ONLY_RE);
    if (priceOnly && pendingTitle) {
      const price = parsePrice(priceOnly[1]!);
      const { title, description } = splitTitleDescription(
        pendingDesc ? `${pendingTitle}: ${pendingDesc}` : pendingTitle,
      );
      if (!isJunkMenuItemTitle(title)) {
        items.push({
          section,
          title,
          description: description || pendingDesc,
          priceAmount: price,
        });
      }
      pendingTitle = null;
      pendingDesc = null;
      continue;
    }

    const withPrice = line.match(
      /^(.{2,90}?)\s+[-—–:·•]?\s*\$?\s*(\d{1,3}(?:[.,]\d{2})?)\s*\$?\s*$/i,
    );
    if (withPrice) {
      flushPending();
      const body = withPrice[1]!.trim();
      const price = parsePrice(withPrice[2]!);
      const { title, description } = splitTitleDescription(body);
      if (letterCount(title) >= 2 && !isJunkMenuItemTitle(title)) {
        items.push({ section, title, description, priceAmount: price });
      }
      continue;
    }

    // Same-line «Name $11.99» without separator
    const glued = line.match(/^(.{2,80}?)\s+\$(\d{1,3}(?:[.,]\d{2})?)\s*$/);
    if (glued) {
      flushPending();
      const { title, description } = splitTitleDescription(glued[1]!.trim());
      if (!isJunkMenuItemTitle(title)) {
        items.push({
          section,
          title,
          description,
          priceAmount: parsePrice(glued[2]!),
        });
      }
      continue;
    }

    // Description continuation under a title waiting for price
    if (pendingTitle && letterCount(line) >= 8 && !looksLikeMenuSection(line)) {
      pendingDesc = pendingDesc ? `${pendingDesc} ${line}` : line;
      continue;
    }

    // New dish title; price may be on the next line
    if (letterCount(line) >= 2 && letterCount(line) <= 80 && !/[.!?]$/.test(line)) {
      flushPending();
      pendingTitle = line;
      pendingDesc = null;
      continue;
    }

    flushPending();
  }
  flushPending();

  // Drop duplicates by title key within the same section
  const seen = new Set<string>();
  const out: ParsedMenuItem[] = [];
  for (const item of items) {
    const key = `${(item.section || "").toLowerCase()}|${item.title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= 80) break;
  }
  return out;
}

/** True when the blob looks like a food menu (sections + several priced lines). */
export function looksLikeMenuDocument(text: string | null | undefined): boolean {
  const raw = String(text || "");
  // Google Maps paste must never become «Меню» (Адрес / Телефон / часы as dishes).
  if (
    MAPS_FIELD_OR_STATUS_RE.test(raw) ||
    /\b(?:suggest\s+new\s+hours|предложить\s+новые\s+часы|подтверждено\s+этим\s+бизнесом|confirmed\s+by\s+this\s+business|отзывов?\s+google|\d+\s*reviews?\b)\b/i.test(
      raw,
    )
  ) {
    return false;
  }
  const items = parseMenuFromText(text);
  if (items.length < 3) return false;
  const priced = items.filter((i) => i.priceAmount != null).length;
  // Count distinct section headers — not «how many rows have any section».
  // Maps dumps used to pass with one fake brand section + unpriced chrome rows.
  const uniqueSections = new Set(
    items.map((i) => (i.section || "").toLowerCase().trim()).filter(Boolean),
  ).size;
  return priced >= 2 && uniqueSections >= 1;
}
