/**
 * Lightweight spell-correction for search tokens.
 * Deterministic — does not depend on the LLM correcting typos like "floring" → "flooring".
 */

import { expandSearchToken } from "@/lib/search/synonyms";

/** Extra dictionary terms beyond synonym groups (trades, common EN/RU search words). */
const EXTRA_VOCAB: readonly string[] = [
  "flooring",
  "floor",
  "floors",
  "hardwood",
  "laminate",
  "vinyl",
  "tile",
  "tiles",
  "carpet",
  "плитка",
  "ламинат",
  "паркет",
  "полы",
  "roofing",
  "roof",
  "roofer",
  "крыша",
  "кровля",
  "painting",
  "painter",
  "маляр",
  "покраска",
  "drywall",
  "гипсокартон",
  "plumbing",
  "plumber",
  "electrician",
  "электрик",
  "hvac",
  "heating",
  "cooling",
  "cleaning",
  "уборка",
  "moving",
  "переезд",
  "landscaping",
  "gardening",
  "lawn",
  "fencing",
  "забор",
  "concrete",
  "бетон",
  "cabinets",
  "countertops",
  "kitchen",
  "bathroom",
  "remodel",
  "renovation",
  "строительство",
  "стройка",
  "contractor",
  "подрядчик",
  "insurance",
  "страховка",
  "realtor",
  "риелтор",
  "недвижимость",
  "notary",
  "нотариус",
  "accounting",
  "бухгалтер",
  "immigration",
  "иммиграция",
  "visa",
  "виза",
  "salon",
  "салон",
  "barber",
  "парикмахер",
  "стрижка",
  "haircut",
  "hair",
  "spa",
  "massage",
  "массаж",
  "fitness",
  "gym",
  "тренировка",
  "ballet",
  "балет",
  "dance",
  "танцы",
  "ballroom",
  "tutoring",
  "daycare",
  "детский",
  "school",
  "школа",
  "restaurant",
  "кафе",
  "bakery",
  "пекарня",
  "grocery",
  "продукты",
  "market",
  "dentist",
  "стоматолог",
  "doctor",
  "clinic",
  "lawyer",
  "attorney",
  "mechanic",
  "auto",
  "tow",
  "эвакуатор",
  "oil",
  "масло",
  "tire",
  "шины",
  "manicure",
  "маникюр",
  "pedicure",
  "педикюр",
  "nails",
  "ногти",
  "handyman",
  "ремонт",
  "сантехник",
  "plumber",
  "translator",
  "переводчик",
  "interpreter",
  "services",
  "услуги",
];

/**
 * Common typo aliases → preferred EXTRA_VOCAB term.
 * Kept separate so they expand for DB OR-search but are never treated as "already correct".
 */
const TYPO_ALIASES: Readonly<Record<string, string>> = {
  floring: "flooring",
  florin: "flooring",
  floorin: "flooring",
  florng: "flooring",
  pluming: "plumbing",
  plumming: "plumbing",
  electrition: "electrician",
  electrian: "electrician",
  manicur: "manicure",
  manicuree: "manicure",
  manikyur: "manicure",
  manikur: "manicure",
  pedicur: "pedicure",
  pedikyur: "pedicure",
  pedikur: "pedicure",
  roofingg: "roofing",
  paintng: "painting",
  chnage: "change",
  chang: "change",
  santehnik: "plumber",
  santehnika: "plumbing",
  elektrik: "electrician",
  stomatolog: "dentist",
  strizhka: "haircut",
  strahovka: "insurance",
  maslo: "oil",
  avtoservis: "auto",
  repetitor: "tutor",
  massazh: "massage",
  notarius: "notary",
  rieltor: "realtor",
  rielter: "realtor",
  buhgalter: "accountant",
  bukhgalter: "accountant",
};

/** Correction targets only — never include typo aliases here. */
function buildVocabulary(): string[] {
  return [...new Set(EXTRA_VOCAB.map((t) => t.toLowerCase()))].filter(
    (t) => t.length >= 3,
  );
}

const VOCAB = buildVocabulary();
const EXTRA_SET = new Set(VOCAB);

/**
 * Never Levenshtein-correct these — short function words / domain terms that
 * collapse into trade vocab ("по"→"пол", "суд"→"сад").
 */
const NEVER_CORRECT = new Set([
  "по",
  "для",
  "мне",
  "нам",
  "нужен",
  "нужна",
  "нужно",
  "нужны",
  "ищу",
  "хочу",
  "где",
  "как",
  "что",
  "это",
  "или",
  "на",
  "из",
  "от",
  "до",
  "со",
  "об",
  "без",
  "при",
  "под",
  "над",
  "кто",
  "есть",
  "ли",
  "бы",
  "же",
  "то",
  "все",
  "всё",
  "еще",
  "ещё",
  "уже",
  "тут",
  "там",
  "сюда",
  "суд",
  "суда",
  "суде",
  "суду",
  "court",
  "zoom",
  "зуум",
  "переводчик",
  "переводчика",
  "переводчику",
  "перевод",
  "translator",
  "interpreter",
  "interpreting",
]);

function preferredCanonicalFromGroup(token: string): string | null {
  if (EXTRA_SET.has(token)) return null;
  const group = expandSearchToken(token);
  if (group.length <= 1) return null;
  const candidates = group.filter((g) => EXTRA_SET.has(g));
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => b.length - a.length)[0] ?? null;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const row = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) row[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(
        row[j] + 1, // deletion
        row[j - 1] + 1, // insertion
        prev + cost, // substitution
      );
      prev = temp;
    }
  }
  return row[b.length];
}

function maxDistanceFor(token: string): number {
  // Short tokens: Levenshtein is too aggressive (по→пол, суд→сад).
  if (token.length <= 4) return 0;
  if (token.length <= 8) return 1;
  return 2;
}

export type SpellCorrection = {
  from: string;
  to: string;
};

export type SpellcheckResult = {
  /** Query/tokens after correction. */
  corrected: string;
  corrections: SpellCorrection[];
};

/**
 * Correct individual tokens against the trade vocabulary.
 * Leaves unknown tokens unchanged when no close match exists.
 */
export function correctSearchText(input: string): SpellcheckResult {
  const parts = input.trim().split(/(\s+)/);
  const corrections: SpellCorrection[] = [];

  const correctedParts = parts.map((part) => {
    if (!part || /^\s+$/.test(part)) return part;
    // Only correct letter tokens (keep numbers/emails/etc.)
    if (!/^[\p{L}]+$/u.test(part)) return part;

    const lower = part.toLowerCase();

    // Explicit typo map first (floring → flooring).
    const mapped = TYPO_ALIASES[lower];
    if (mapped && mapped !== lower) {
      corrections.push({ from: part, to: mapped });
      return mapped;
    }

    if (NEVER_CORRECT.has(lower)) return part;

    // Synonym-group alias that isn't a canonical EXTRA term → longest EXTRA member.
    const fromGroup = preferredCanonicalFromGroup(lower);
    if (fromGroup && fromGroup !== lower) {
      corrections.push({ from: part, to: fromGroup });
      return fromGroup;
    }

    if (EXTRA_SET.has(lower)) return part;

    const maxDist = maxDistanceFor(lower);
    if (maxDist <= 0) return part;

    let best: string | null = null;
    let bestDist = Number.POSITIVE_INFINITY;

    for (const candidate of VOCAB) {
      // Don't rewrite a short word into a much longer trade term.
      if (candidate.length > lower.length + maxDist) continue;
      if (Math.abs(candidate.length - lower.length) > maxDist) continue;
      const dist = levenshtein(lower, candidate);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      } else if (dist === bestDist && best && candidate.length > best.length) {
        best = candidate;
      }
    }

    if (best && bestDist > 0 && bestDist <= maxDist) {
      corrections.push({ from: part, to: best });
      return best;
    }
    return part;
  });

  return {
    corrected: correctedParts.join("").replace(/\s+/g, " ").trim(),
    corrections,
  };
}

/** Correct an array of intent tokens in place-friendly way. */
export function correctTokenList(tokens: string[]): {
  tokens: string[];
  corrections: SpellCorrection[];
} {
  const corrections: SpellCorrection[] = [];
  const out: string[] = [];
  for (const token of tokens) {
    const { corrected, corrections: local } = correctSearchText(token);
    out.push(corrected);
    corrections.push(...local);
  }
  return { tokens: out, corrections };
}
