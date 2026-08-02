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

const NOISE_LINE_RE =
  /^(?:overview|reviews|photos|directions|website|save|share|call|open\s+now|google|maps?|menu|меню)\b/i;

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

/** Section header: no price, short, often ALL CAPS or known food section word. */
export function looksLikeMenuSection(line: string): boolean {
  const t = cleanLine(line);
  if (!t || t.length > 60) return false;
  if (PRICE_TAIL_RE.test(t) || PRICE_ONLY_RE.test(t)) return false;
  if (NOISE_LINE_RE.test(t)) return false;
  if (/^https?:\/\//i.test(t)) return false;
  const letters = letterCount(t);
  if (letters < 3) return false;
  if (SECTION_HINT_RE.test(t)) return true;
  // ALL CAPS heading (BREAKFAST, TRADITIONAL HOMEMADE FAVORITES)
  if (t === t.toUpperCase() && letters >= 4 && !/\d/.test(t)) return true;
  // Title Case multi-word without sentence punctuation
  if (
    /^[A-Z][A-Za-z'’\-]+(?:\s+[A-Z][A-Za-z'’\-\/]+)+$/.test(t) &&
    !/[.!?]$/.test(t) &&
    t.split(/\s+/).length <= 6
  ) {
    return true;
  }
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
    .filter((l) => l.length > 0 && !NOISE_LINE_RE.test(l));

  const items: ParsedMenuItem[] = [];
  let section: string | null = null;
  let pendingTitle: string | null = null;
  let pendingDesc: string | null = null;

  const flushPending = () => {
    if (!pendingTitle) return;
    const { title, description } = splitTitleDescription(
      pendingDesc ? `${pendingTitle}: ${pendingDesc}` : pendingTitle,
    );
    if (letterCount(title) >= 2) {
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
      items.push({
        section,
        title,
        description: description || pendingDesc,
        priceAmount: price,
      });
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
      if (letterCount(title) >= 2) {
        items.push({ section, title, description, priceAmount: price });
      }
      continue;
    }

    // Same-line «Name $11.99» without separator
    const glued = line.match(/^(.{2,80}?)\s+\$(\d{1,3}(?:[.,]\d{2})?)\s*$/);
    if (glued) {
      flushPending();
      const { title, description } = splitTitleDescription(glued[1]!.trim());
      items.push({
        section,
        title,
        description,
        priceAmount: parsePrice(glued[2]!),
      });
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
  const items = parseMenuFromText(text);
  if (items.length < 3) return false;
  const priced = items.filter((i) => i.priceAmount != null).length;
  const withSection = items.filter((i) => i.section).length;
  return priced >= 2 || (withSection >= 2 && items.length >= 4);
}
