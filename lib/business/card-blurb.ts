/**
 * Listing-card teaser: short Russian only.
 * English blurbs stay off the preview; category name is the last resort.
 */

const CYRILLIC_RE = /[А-Яа-яЁё]/;

const NOISE_LINE_RE =
  /^(?:тел(?:ефон)?|phone|call|whatsapp|telegram|тг|email|instagram|инстаграм|facebook|fb|google|yelp|source|источник)\b/i;

const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu;

export function hasCyrillic(text: string | null | undefined): boolean {
  return Boolean(text && CYRILLIC_RE.test(text));
}

/** True when name / short / description have any Russian letters. */
export function businessHasRussianCopy(input: {
  name?: string | null;
  shortDescription?: string | null;
  description?: string | null;
}): boolean {
  return (
    hasCyrillic(input.name) ||
    hasCyrillic(input.shortDescription) ||
    hasCyrillic(input.description)
  );
}

function cyrillicLetterRatio(text: string): number {
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (!letters) return 0;
  const cyr = (letters.match(/[А-Яа-яЁё]/g) ?? []).length;
  return cyr / letters.length;
}

function cleanLine(raw: string): string {
  return raw
    .replace(EMOJI_RE, " ")
    .replace(/[*#_~`|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Prefer lines that are mostly Cyrillic; skip contact-only noise. */
function russianLines(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/\n+/)) {
    const line = cleanLine(part);
    if (!line || line.length < 3) continue;
    if (NOISE_LINE_RE.test(line)) continue;
    if (!hasCyrillic(line)) continue;
    // Skip «Услуги: EZ Gel under eyes…» style crumbs
    if (cyrillicLetterRatio(line) < 0.45) continue;
    out.push(line);
  }
  return out;
}

/**
 * Compact teaser: ~2–8 words / ≤72 chars, Russian only.
 * Falls back to category name (already Russian in catalog).
 */
export function businessCardBlurb(input: {
  shortDescription?: string | null;
  description?: string | null;
  categoryName?: string | null;
  maxChars?: number;
}): string | null {
  const maxChars = input.maxChars ?? 72;
  const candidates = [
    ...russianLines(input.shortDescription ?? ""),
    ...russianLines(input.description ?? ""),
  ];

  for (const line of candidates) {
    const clipped = clipRussianBlurb(line, maxChars);
    if (clipped) return clipped;
  }

  const category = cleanLine(input.categoryName ?? "");
  if (category && hasCyrillic(category)) return category;
  return null;
}

function clipRussianBlurb(line: string, maxChars: number): string | null {
  // Drop leading Latin brand crumbs: "Skinovation — медицинский спа"
  let text = line.replace(/^[A-Za-z0-9][A-Za-z0-9 .,'&/-]{0,40}[—–\-·:|]\s+/, "");
  text = cleanLine(text);
  if (!hasCyrillic(text)) text = line;

  // Keep through first sentence-ish break
  const sentence = text.split(/(?<=[.!?…])\s+/)[0] ?? text;
  const words = sentence.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  let out = "";
  for (const word of words.slice(0, 10)) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > maxChars) break;
    out = next;
    // Prefer stopping after a few words once we have Russian substance
    if (out.split(/\s+/).length >= 8) break;
  }
  out = out.replace(/[,:;·\-—–]+$/u, "").trim();
  if (!hasCyrillic(out) || out.length < 3) return null;
  if (out.length < sentence.length && !/[.!?…]$/.test(out)) {
    // ellipsis only when we truncated mid-thought and still have more words
    if (words.length > out.split(/\s+/).length) out = `${out}…`;
  }
  return out;
}

/** Short Russian label from business category slug (for DB backfill). */
export function russianBlurbForCategorySlug(
  slug: string | null | undefined,
): string {
  switch (slug) {
    case "restaurants":
      return "Русский ресторан";
    case "groceries":
      return "Продукты";
    case "beauty":
      return "Салон красоты";
    case "auto":
      return "Автосервис";
    case "medical":
      return "Медицина";
    case "legal":
      return "Юридические услуги";
    case "education":
      return "Образование";
    case "real_estate":
      return "Недвижимость";
    case "fitness":
      return "Спорт и фитнес";
    case "pets":
      return "Животные";
    case "finance":
      return "Финансы и бухгалтерия";
    case "insurance":
      return "Страхование";
    case "travel":
      return "Путешествия";
    case "events":
    case "celebrations":
      return "Организация праздников";
    case "services":
      return "Услуги и быт";
    default:
      return "Русскоязычный бизнес";
  }
}
