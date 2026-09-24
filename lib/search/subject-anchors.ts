/**
 * Subject / specialty anchors for precise service search
 * (e.g. «репетитор по испанскому» must not match math tutors).
 */

import { expandSearchToken, haystackMatchesToken } from "@/lib/search/synonyms";

/**
 * Each group is one subject. First entry is the canonical label used in hints.
 * Keep stems short enough to match declined Russian forms via includes().
 */
export const SUBJECT_ANCHOR_GROUPS: readonly (readonly string[])[] = [
  // Languages
  [
    "испанский",
    "испанского",
    "испанскому",
    "испанском",
    "испанская",
    "spanish",
    "español",
    "espanol",
  ],
  [
    "английский",
    "английского",
    "английскому",
    "английском",
    "english",
    "английск",
  ],
  [
    "французский",
    "французского",
    "французскому",
    "french",
    "франц",
  ],
  ["немецкий", "немецкого", "немецкому", "german", "немецк"],
  ["китайский", "китайского", "китайскому", "chinese", "китайск", "mandarin"],
  ["японский", "японского", "японскому", "japanese", "японск"],
  ["корейский", "корейского", "корейскому", "korean", "корейск"],
  ["итальянский", "итальянского", "итальянскому", "italian", "итальянск"],
  ["португальский", "португальского", "portuguese", "португальск"],
  ["арабский", "арабского", "arabic", "арабск"],
  ["иврит", "hebrew", "иврита"],
  ["польский", "польского", "polish", "польск"],
  ["турецкий", "турецкого", "turkish", "турецк"],
  ["хинди", "hindi"],

  // School / STEM
  [
    "математика",
    "математике",
    "математики",
    "математикой",
    "math",
    "mathematics",
    "матем",
  ],
  ["алгебра", "алгебре", "алгебры", "algebra"],
  ["геометрия", "геометрии", "geometry"],
  [
    "физика",
    "физике",
    "физики",
    "physics",
    "физик",
  ],
  [
    "химия",
    "химии",
    "химию",
    "chemistry",
    "хими",
  ],
  ["биология", "биологии", "biology", "биолог"],
  ["информатика", "информатике", "programming", "coding", "программирован"],
  ["история", "истории", "history"],
  ["география", "географии", "geography"],
  ["литература", "литературе", "literature"],
  ["русский язык", "русскому языку", "russian language"],
  ["sat", "act", "ielts", "toefl", "егэ", "огэ"],
  ["фортепиано", "piano", "пианино"],
  ["гитара", "гитаре", "guitar"],
  ["скрипка", "violin"],
  ["вокал", "vocal", "пение", "singing"],
];

/** Service words that alone must not pass the strong-match gate without a subject. */
export const GENERIC_SERVICE_HINTS = new Set([
  "репетитор",
  "репетитора",
  "репетиторы",
  "учитель",
  "учителя",
  "tutor",
  "tutors",
  "tutoring",
  "teacher",
  "teachers",
  "teaching",
  "преподаватель",
  "преподавателя",
]);

const SUBJECT_LOOKUP = new Map<string, readonly string[]>();
for (const group of SUBJECT_ANCHOR_GROUPS) {
  const normalized = group.map((g) => g.toLowerCase());
  for (const token of normalized) {
    SUBJECT_LOOKUP.set(token, normalized);
  }
}

/** True if token (or its synonym group) is a known subject anchor. */
export function isSubjectAnchorToken(token: string): boolean {
  const lower = token.toLowerCase().trim();
  if (SUBJECT_LOOKUP.has(lower)) return true;
  // Prefix match for declined forms not listed exhaustively (испанск…)
  for (const [key] of SUBJECT_LOOKUP) {
    if (key.length >= 5 && (lower.startsWith(key) || key.startsWith(lower))) {
      return true;
    }
  }
  return false;
}

/** Expand a subject token to its full group (or itself). */
export function expandSubjectToken(token: string): string[] {
  const lower = token.toLowerCase().trim();
  const group = SUBJECT_LOOKUP.get(lower);
  if (group) return [...group];
  for (const [key, g] of SUBJECT_LOOKUP) {
    if (key.length >= 5 && (lower.startsWith(key.slice(0, 5)) || key.startsWith(lower.slice(0, 5)))) {
      if (lower.includes(key.slice(0, Math.min(5, key.length))) || key.includes(lower.slice(0, 5))) {
        return [...g];
      }
    }
  }
  return expandSearchToken(lower);
}

/**
 * Pull subject anchors from free text + existing hint list.
 * Returns canonical (first) labels for each matched group (deduped).
 */
export function extractSubjectAnchors(
  text: string,
  extraTokens: string[] = [],
): string[] {
  const hay = `${text} ${extraTokens.join(" ")}`.toLowerCase();
  const found: string[] = [];
  const seen = new Set<string>();

  for (const group of SUBJECT_ANCHOR_GROUPS) {
    const canonical = group[0];
    const hit = group.some((term) => {
      const t = term.toLowerCase();
      if (t.length < 3) return hay.includes(t);
      // Word-ish: allow «по испанскому», «spanish tutor»
      return hay.includes(t);
    });
    if (hit && !seen.has(canonical)) {
      seen.add(canonical);
      found.push(canonical);
    }
  }
  return found;
}

/** Card text matches at least one required subject (synonyms included). */
export function haystackMatchesAnySubject(
  haystack: string,
  subjects: string[],
): boolean {
  if (subjects.length === 0) return true;
  const hay = haystack.toLowerCase();
  return subjects.some((subject) => {
    const variants = expandSubjectToken(subject);
    return variants.some((v) => v.length >= 2 && hay.includes(v));
  });
}

export function businessHaystack(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

/**
 * Soft hints that are only generic trade words (tutor/teacher…) —
 * used to detect when a subject gate should apply.
 */
export function hintsAreGenericServiceOnly(hints: string[]): boolean {
  const meaningful = hints
    .map((h) => h.toLowerCase().trim())
    .filter((h) => h.length >= 2);
  if (meaningful.length === 0) return false;
  return meaningful.every(
    (h) =>
      GENERIC_SERVICE_HINTS.has(h) ||
      expandSearchToken(h).every((v) => GENERIC_SERVICE_HINTS.has(v)),
  );
}

export { haystackMatchesToken };
