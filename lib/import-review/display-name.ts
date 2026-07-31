/** Display helpers for import-review queue cards (junk titles, category labels). */

import { demathAlnum } from "@/lib/admin/paste-enrich";

const JUNK_TITLES = new Set(
  [
    "messenger",
    "whatsapp",
    "telegram",
    "gmail.com",
    "yahoo.com",
    "mail.com",
    "outlook.com",
    "hotmail.com",
    "instagram",
    "facebook",
    "unknown",
    "user",
    "admin",
    "null",
    "none",
    "n/a",
    "без названия",
    // Role / category words the extractor puts in title instead of a name.
    "мастер",
    "master",
    "specialist",
    "специалист",
    "парикмахер",
    "стилист",
    "косметолог",
    "визажист",
    "няня",
    "репетитор",
    "врач",
    "доктор",
    "агент",
    "риелтор",
    "риэлтор",
    "переводчик",
    "водитель",
    "повар",
    "массажист",
    "маникюр",
    "педикюр",
  ].map((s) => s.toLowerCase()),
);

const EMAIL_DOMAIN_RE = /^[a-z0-9.-]+\.(com|net|org|ru|io|co|info)$/i;

/** Meta labels from posts («Контакты», «Когда: …») — never an entity name. */
const META_LABELS =
  "контакты?|contacts?|телефон\\w*|phone|почта|e-?mail|когда|when|дата|date|где|where|адрес|address|локация|location|билеты?|tickets?|цена|price|стоимость|оплат[аы]|payment|форма|form|регистрац\\w*|registration|запись|как\\s+записаться|как\\s+оплатить|тема|theme|возраст|age|продолжительность|duration|описание|description|услуги|services|график|расписание|hours";

const META_ONLY_RE = new RegExp(`^\\s*(?:${META_LABELS})\\s*[:：]?\\s*$`, "iu");
const META_PREFIX_RE = new RegExp(`^\\s*(?:${META_LABELS})\\s*[:：]`, "iu");

/** Affiche CTAs («Пишите «+»…») — never an event / entity name. */
const CTA_OPENER_RE =
  /^(?:пишите|пиши(?:те)?|напишите|присоединяйтесь|подписывайтесь|жмите|ставьте\s*[«"]?\+|оставьте\s+комментар\w*|write\s+[«"]?\+|join\s+(?:us|our)|click\s+(?:here|the\s+link)|comment\s+[«"]?\+|leave\s+a\s+comment)[\s,!.:;—–«»"'+]*/iu;

const QUOTED_NAME_RE = /[«"“„]([^«»"“”„\n]{2,60})[»"”]/gu;

const LETTER_RE = /\p{L}/gu;

function letterCount(value: string): number {
  return (value.match(LETTER_RE) || []).length;
}

const BRAND_TOKEN_RE =
  /\b(clinic|studio|salon|center|centre|school|camp|spa|dental|dentistry|recovery|group|company|llc|inc|house|beauty|preschool|restaurant|cafe|café|kitchen|market|shop|store|halal|gym|academy|institute|lab|labs|therapy|massage|services|service|registration|kids|club|truck|trailer|repair|motors|jewelry|cargo|express|logistics|delivery|movers|transport|клиник|студи|салон|центр|школ|лагер|спа|ресторан|кафе|садик|садок|магазин|агентств|мастерск|сервис|карго|доставка)\b/i;

const CATEGORY_DOT_NAME_RE =
  /^[A-Za-zА-Яа-яЁё0-9]{1,20}\s*[·•]\s*[a-z][a-z0-9_]{1,40}$/;
const REDDIT_USER_NAME_RE = /^[A-Z][a-z]+[A-Z][a-z]+\d{2,}$/;
const SNAKE_OR_HANDLE_RE = /^_?[a-z0-9]+(?:_[a-z0-9]+)*_?$/;

const PERSON_LIKE_RE =
  /^[A-ZА-ЯЁ][a-zа-яё'’-]+(?:\s+[A-ZА-ЯЁ][a-zа-яё'’-]+){1,2}$/u;

const NON_NAME_TOKENS = new Set([
  "art",
  "backyard",
  "house",
  "beauty",
  "title",
  "company",
  "sky",
  "neptune",
  "seafood",
  "fish",
  "cafe",
  "camp",
  "design",
  "market",
  "shop",
  "store",
  "group",
  "auto",
  "dental",
  "school",
  "studio",
  "salon",
  "clinic",
  "spa",
  "gym",
  "kids",
  "food",
  "home",
  "care",
  "office",
  "service",
  "services",
]);

/** Russian labels for AI category slugs shown in admin queue. */
export const IMPORT_CATEGORY_LABELS: Record<string, string> = {
  auto_services: "Автосервис",
  beauty: "Красота",
  childcare: "Дети / няни",
  cleaning: "Клининг",
  education: "Образование",
  events: "Организация праздников",
  celebrations: "Организация праздников",
  fitness: "Фитнес",
  food: "Еда",
  health: "Здоровье",
  home_services: "Дом и ремонт",
  insurance: "Страхование",
  legal: "Юридические услуги",
  moving: "Переезды",
  other: "Другое",
  professional_services: "Проф. услуги",
  real_estate_services: "Недвижимость",
  accounting: "Бухгалтерия",
  car_rental: "Аренда авто",
};

export function importCategoryLabel(slug: string | null | undefined): string {
  const key = (slug || "").trim().toLowerCase();
  if (!key) return "Без категории";
  return IMPORT_CATEGORY_LABELS[key] || key;
}

export function isJunkImportTitle(raw: string | null | undefined): boolean {
  const t = (raw || "").trim();
  if (!t) return true;
  const lower = t.toLowerCase();
  if (JUNK_TITLES.has(lower)) return true;
  if (META_ONLY_RE.test(t) || META_PREFIX_RE.test(t)) return true;
  if (CTA_OPENER_RE.test(t)) return true;
  if (letterCount(t) < 3) return true;
  if (EMAIL_DOMAIN_RE.test(lower)) return true;
  if (lower.includes("@")) return true;
  if (CATEGORY_DOT_NAME_RE.test(t)) return true;
  if (REDDIT_USER_NAME_RE.test(t)) return true;
  if (SNAKE_OR_HANDLE_RE.test(t) && t.length >= 4 && !BRAND_TOKEN_RE.test(t.replaceAll("_", " "))) {
    return true;
  }
  if (t.startsWith("$") || (t.endsWith("?") && t.length < 40)) return true;
  return false;
}

/** Facebook author style: «Asiya Ahmadi», not «NeroFix Recovery Clinic». */
export function isPersonLikeImportName(raw: string | null | undefined): boolean {
  const n = (raw || "").trim().replace(/\s+/g, " ");
  if (!n || BRAND_TOKEN_RE.test(n)) return false;
  const parts = n.split(" ");
  if (
    parts.length === 3 &&
    PERSON_LIKE_RE.test(`${parts[0]} ${parts[1]}`) &&
    ["hair", "nails", "beauty", "makeup", "photo"].includes(parts[2].toLowerCase())
  ) {
    return true;
  }
  if (!PERSON_LIKE_RE.test(n)) return false;
  if (parts.some((p) => NON_NAME_TOKENS.has(p.toLowerCase()))) return false;
  return true;
}

function cleanBrand(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/^[\s.«»"'“”]+|[\s.«»"'“”.,;!:—–-]+$/g, "")
    .trim()
    .slice(0, 80);
}

function preferMixedCase(brand: string, text: string): string {
  if (!/^[A-Z0-9][A-Z0-9 &'’-]+$/.test(brand) || brand.length < 4) return brand;
  const re = new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  let mixed: string | null = null;
  for (const m of text.matchAll(re)) {
    const hit = m[0];
    if (hit !== brand && hit !== hit.toUpperCase()) {
      mixed = hit;
      break;
    }
  }
  if (mixed) return cleanBrand(mixed);
  return brand
    .split(" ")
    .map((w) => (w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase()))
    .join(" ");
}

function acceptBrand(cand: string | null | undefined, current?: string): string | null {
  if (!cand) return null;
  const c = cleanBrand(cand);
  if (c.length < 3) return null;
  if (isJunkImportTitle(c)) return null;
  if (!/^[A-ZА-ЯЁ0-9]/u.test(c)) return null;
  if (
    /^(открытие|opening|наш|наша|our|this|the|по\s|в\s)/i.test(c) ||
    /\b(по адресу|совмещают|принимает|для вашего)\b/i.test(c)
  ) {
    return null;
  }
  if (
    /^(hair|nail|beauty|auto|home|call|old|private|this)\s+(salon|studio|center|school|business|company|spa|shop)$/i.test(
      c,
    )
  ) {
    return null;
  }
  if (current && c.toLowerCase() === current.trim().toLowerCase()) return null;
  if (isPersonLikeImportName(c) && !BRAND_TOKEN_RE.test(c) && !/^(dr\.?|доктор)\b/i.test(c)) {
    return null;
  }
  return c;
}

/** Sentence openers and section labels that look like names but are not. */
const BRAND_STOPWORDS = new Set([
  "здравствуйте",
  "привет",
  "внимание",
  "важно",
  "новинка",
  "акция",
  "тарифы",
  "цены",
  "адрес",
  "адреса",
  "контакты",
  "инстаграм",
  "instagram",
  "telegram",
  "whatsapp",
  "facebook",
  "мы",
  "наши",
  "все",
  "также",
  "если",
  "друзья",
  "россия",
  "беларусь",
  "украина",
  "казахстан",
  "кыргызстан",
  "сша",
  "usa",
  "america",
  "california",
  "new",
  "north",
  "south",
  "east",
  "west",
  "the",
  "and",
  "for",
  "with",
]);

const BRAND_CANDIDATE_RE =
  /\b([A-ZА-ЯЁ][\p{L}\p{N}&'’-]{1,24}(?:\s+[A-ZА-ЯЁ][\p{L}\p{N}&'’-]{1,24}){0,2})\b/gu;

/**
 * «North Hollywood — My Barber LA» is a pickup venue, not the advertiser.
 * True brands sit before the dash («OWAY Cargo — надёжная доставка»).
 */
function isVenueAfterDash(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 48), index);
  return /[—–-]\s*$/.test(before);
}

/**
 * The name an ad repeats is the brand. Works where keyword patterns fail —
 * «OWAY Cargo» has no Clinic / Studio token but is named three times.
 *
 * Deliberately strict: only a single clear leader (count >= 2, no tie) wins,
 * so an ad mentioning two companies returns nothing rather than a guess.
 * Venue names that only appear after «City — …» are ignored.
 */
export function repeatedBrandFromText(
  description: string | null | undefined,
): string | null {
  const text = (description || "").replace(/\s+/g, " ").trim();
  if (text.length < 40) return null;

  type Stat = {
    display: string;
    words: number;
    count: number;
    at: number;
    brandish: boolean;
  };
  const stats = new Map<string, Stat>();
  for (const match of text.matchAll(BRAND_CANDIDATE_RE)) {
    const at = match.index ?? text.length;
    // Skip «City — Venue» hits so pickup partners never outrank the advertiser.
    if (isVenueAfterDash(text, at)) continue;

    const words = cleanBrand(match[1] || "").split(" ");
    // Count every leading sub-phrase: «OWAY Cargo Instagram» also votes for
    // «OWAY Cargo», so a trailing word cannot split the tally.
    for (let n = 1; n <= words.length; n += 1) {
      const phrase = words.slice(0, n).join(" ");
      if (phrase.length < 4) continue;
      if (words.slice(0, n).some((w) => BRAND_STOPWORDS.has(w.toLowerCase()))) {
        break;
      }
      if (n === 1 && !/[A-Z]{2,}/.test(phrase)) continue;
      const key = phrase.toLowerCase();
      const seen = stats.get(key);
      if (seen) seen.count += 1;
      else
        stats.set(key, {
          display: phrase,
          words: n,
          count: 1,
          at,
          brandish: BRAND_TOKEN_RE.test(phrase),
        });
    }
  }

  const ranked = [...stats.values()]
    .filter((s) => s.count >= 2)
    .sort(
      (a, b) =>
        b.count - a.count ||
        Number(b.brandish) - Number(a.brandish) ||
        b.words - a.words ||
        a.at - b.at,
    );
  if (!ranked.length) return null;
  // Two different names repeated equally often — the ad mentions several
  // companies, so guessing between them would be worse than saying nothing.
  // A brand-token leader (Cargo / Studio) may still win over a tied generic.
  const family = (s: Stat) => s.display.split(" ")[0].toLowerCase();
  const top = ranked[0];
  const rival = ranked.find(
    (s) =>
      family(s) !== family(top) &&
      s.count === top.count &&
      Number(s.brandish) === Number(top.brandish),
  );
  if (rival) return null;
  return acceptBrand(top.display);
}

/**
 * The one-line pitch an ad puts next to its own name:
 * «OWAY Cargo — надёжная доставка из США в страны СНГ».
 */
export function taglineForBrand(
  description: string | null | undefined,
  brand: string | null | undefined,
): string | null {
  const text = (description || "").replace(/\s+/g, " ").trim();
  const name = (brand || "").trim();
  if (!text || name.length < 3) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `${escaped}\\s*(?:[—–]|-{1,2}|\\bis\\s+a\\b)\\s*([^.!?\\n]{10,140})`,
    "iu",
  );
  const hit = text.match(re)?.[1]?.trim();
  if (!hit) return null;
  const tagline = hit.replace(/[\s,;:—–-]+$/, "").trim();
  if (letterCount(tagline) < 10) return null;
  return tagline.slice(0, 160);
}

/** Explicit name in quotes: «В гости к Сказке», "Заюшкина избушка". */
function quotedNameFromText(raw: string): string | null {
  for (const line of raw.split("\n").slice(0, 12)) {
    const t = line.trim();
    if (!t || META_ONLY_RE.test(t) || META_PREFIX_RE.test(t)) continue;
    for (const m of t.matchAll(QUOTED_NAME_RE)) {
      const candidate = cleanBrand(m[1] || "");
      if (
        candidate.length >= 3 &&
        letterCount(candidate) >= 3 &&
        !isJunkImportTitle(candidate)
      ) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Infer a brand/person name from ad text when title is junk
 * (e.g. Telegram sender = "Messenger", email domain = "gmail.com"),
 * or when the title is the Facebook author while the post names the business.
 */
export function inferNameFromDescription(description: string | null | undefined): string | null {
  const text = (description || "").trim();
  if (!text) return null;
  const head = text.slice(0, 900);
  const flat = text.replace(/\s+/g, " ").trim();

  const patterns: RegExp[] = [
    /(?:открытие|открытии|открытия|opening)\s+([A-ZА-ЯЁ0-9][A-ZА-ЯЁA-Za-zА-Яа-яЁё0-9&'’. \-]{2,55})/iu,
    /^[\s\W]*([A-Z][A-Z0-9 &']{3,50}(?:REPAIR|SERVICES|STUDIO|CLINIC|SALON|CENTER|CAMP|SCHOOL|CAFE|GROUP|MOTORS|ACADEMY))\s*[—–\-|!]/m,
    /^[\s\W]*([A-Z][A-Za-z0-9&'’\-]{2,40})\s+is\s+a\s+(?:small\s+)?(?:family\s+)?(?:business|studio|salon|clinic|company|shop)\b/m,
    /(?:в|у)\s+(?:ресторане|кафе|студии|салоне|клинике|центре|школе|лагере|магазине|агентстве)\s+[«"“]?([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9'’\-]*(?:\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9'’\-]*){0,4})/iu,
    /([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9'’\-]*(?:\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9'’\-]*){0,4})\s*[—–-]\s*(?:это|студия|салон|клиника|лагерь|центр)\b/iu,
    /^[\s\W]*([A-Z][A-Za-z0-9&'’. \-]{2,55}?)\s+offers\b/im,
    /\b((?:Dr\.?|Doctor)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+offers\b/,
    /(?:порекомендовать|рекомендую|recommend(?:ing)?)\s+([A-Z][A-Za-z0-9&'’\-]*(?:\s+[A-Z][A-Za-z0-9&'’\-]*){1,5})/,
    /\b([A-Z][A-Za-z0-9&'’-]+(?:\s+[A-Z][A-Za-z0-9&'’-]+){0,4}\s+(?:Clinic|Studio|Salon|Center|Centre|School|Camp|Spa|Dental|Dentistry|Recovery(?:\s+Clinic)?|Group|Company|Preschool|Restaurant|Cafe|Kitchen|Services|Kids\s+Club|House\s+of\s+Beauty))\b/,
    /(?:название|компани[яи]|бизнес)\s*[:：]\s*[«"]?([A-ZА-ЯЁ][^"\n«»]{2,50})/iu,
    /(?:добро\s+пожаловать\s+в\s+|welcome\s+to\s+)[«"“]?([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9'’\-]*(?:\s+[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё0-9'’\-]*){0,4})/iu,
    /([A-ZА-ЯЁ][\wА-Яа-яЁё.&'’-]{1,40}(?:\s+[A-ZА-ЯЁa-zа-яё][\wА-Яа-яЁё.&'’-]{0,40}){0,4})\s+(?:предоставляет|поможет|предлагает|offers|provides|специализир)/iu,
    /(?:компания|студия|салон|сервис|service)\s+[«"]?([A-ZА-ЯЁ][\wА-Яа-яЁё.&'’\s-]{2,50})[»"]?/iu,
  ];

  for (const re of patterns) {
    const m = head.match(re) || flat.match(re);
    let candidate = m?.[1]?.trim() ?? null;
    if (m?.[0] && /^(открытие|открытии|открытия|opening)\b/i.test(m[0])) {
      candidate = m[0]
        .replace(/^(открытие|открытии|открытия|opening)\s+/i, "")
        .trim();
      // Keep Title-case run only («Wizards Registration Services в Costa…»)
      const parts = candidate.split(/\s+/);
      const kept: string[] = [];
      for (const p of parts) {
        if (/^[A-ZА-ЯЁ0-9]/.test(p) || ["&", "and", "of", "the", "for"].includes(p.toLowerCase())) {
          kept.push(p);
        } else break;
      }
      candidate = kept.join(" ");
    }
    const accepted = acceptBrand(candidate);
    if (accepted) {
      const solid =
        BRAND_TOKEN_RE.test(accepted) ||
        /^(dr\.?|доктор)\b/i.test(accepted) ||
        (/[A-Z][a-z]+[A-Z]|Halal|Cafe|Café/.test(accepted) &&
          accepted.split(" ").length <= 3);
      if (solid) return preferMixedCase(accepted, text);
    }
  }

  return quotedNameFromText(demathAlnum(text)) ?? repeatedBrandFromText(text);
}

/** Prefer real Instagram handles; drop email domains mistaken as IG. */
export function sanitizeInstagramHandles(values: string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of values ?? []) {
    const v = raw.trim().replace(/^@/, "");
    if (!v) continue;
    if (v.includes("@")) continue;
    const lower = v.toLowerCase();
    if (JUNK_TITLES.has(lower) || EMAIL_DOMAIN_RE.test(lower)) continue;
    if (lower.endsWith(".com") || lower.endsWith(".net") || lower.endsWith(".org")) {
      continue;
    }
    if (!/^[A-Za-z0-9._]{2,30}$/.test(v)) continue;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** Best display name for queue / preview cards. */
export function resolveImportDisplayName(input: {
  title?: string | null;
  business_name?: string | null;
  person_name?: string | null;
  description?: string | null;
  source_text?: string | null;
  instagram?: string[] | null;
}): { name: string; inferred: boolean; junkSource: boolean } {
  const desc = input.description || input.source_text;
  const fromDesc = inferNameFromDescription(desc);

  // business_name wins when it is a real brand (not a person-author label)
  const business = input.business_name?.trim();
  if (business && !isJunkImportTitle(business) && !isPersonLikeImportName(business)) {
    return { name: business, inferred: false, junkSource: false };
  }

  // Person/author in title fields → prefer brand spelled out in the post
  const personish = [input.title, input.person_name, input.business_name]
    .map((c) => c?.trim())
    .filter(Boolean) as string[];
  const looksLikeAuthor = personish.some(
    (c) => isPersonLikeImportName(c) || isJunkImportTitle(c),
  );
  if (fromDesc && looksLikeAuthor) {
    return { name: fromDesc, inferred: true, junkSource: true };
  }

  const candidates = [input.business_name, input.title, input.person_name];
  for (const c of candidates) {
    if (c && !isJunkImportTitle(c)) {
      return { name: c.trim(), inferred: false, junkSource: false };
    }
  }

  if (fromDesc) {
    return { name: fromDesc, inferred: true, junkSource: true };
  }

  const ig = sanitizeInstagramHandles(input.instagram)[0];
  if (ig) {
    return { name: ig, inferred: true, junkSource: true };
  }

  const fallback =
    candidates.map((c) => c?.trim()).find(Boolean) || "Без названия";
  return { name: fallback, inferred: false, junkSource: isJunkImportTitle(fallback) };
}
