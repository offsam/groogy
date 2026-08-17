import "server-only";

import {
  completeJsonWithFailover,
  OpenRouterError,
} from "@/lib/ai/openrouter";
import { SEARCH_CATALOG_PLAYBOOK } from "@/lib/ai/search-playbook";
import { expandSearchToken } from "@/lib/search/synonyms";

export type SearchQueryMode =
  | "service_need"
  | "business_name"
  | "specialty"
  | "browse";

export type SearchIntent = {
  keywords: string[];
  city: string | null;
  categorySlug: string | null;
  mustHints: string[];
  /**
   * True for “I need a service” / category-browse queries.
   * Search then browses the category and ranks likely matches, instead of
   * requiring every keyword to appear in the card text.
   */
  preferCategory: boolean;
  /** User asked for nearby / “рядом со мной”. */
  nearMe: boolean;
  /** How to interpret the query for ranking + DB strategy. */
  queryMode: SearchQueryMode;
};

export type ParsedSearchIntent = {
  intent: SearchIntent;
  modelUsed: string;
};

type CategoryHint = {
  slug: string;
  name: string;
};

function parseJsonObject(content: string): unknown {
  let text = content.trim();
  if (text.startsWith("```")) {
    text = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
  }
  return JSON.parse(text) as unknown;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    for (const part of item.split(/[^\p{L}\p{N}]+/u)) {
      const token = part.trim();
      if (token.length >= 2) out.push(token);
    }
  }
  return out.slice(0, 12);
}

/** Keep short phrases (e.g. "oil change") for ranking hints. */
function asHintArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const phrase = item.trim().toLowerCase().replace(/\s+/g, " ");
    if (phrase.length < 2) continue;
    out.push(phrase);
    // Also index individual tokens for synonym matching.
    for (const part of phrase.split(/[^\p{L}\p{N}]+/u)) {
      const token = part.trim();
      if (token.length >= 3 && token !== phrase) out.push(token);
    }
  }
  return [...new Set(out)].slice(0, 16);
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1" || v === "yes") return true;
    if (v === "false" || v === "0" || v === "no") return false;
  }
  return fallback;
}

const QUERY_MODES = new Set<SearchQueryMode>([
  "service_need",
  "business_name",
  "specialty",
  "browse",
]);

function asQueryMode(
  value: unknown,
  preferCategory: boolean,
): SearchQueryMode {
  if (typeof value === "string") {
    const v = value.trim().toLowerCase() as SearchQueryMode;
    if (QUERY_MODES.has(v)) return v;
  }
  return preferCategory ? "service_need" : "specialty";
}

/**
 * Expand tokens with RU↔EN synonym group members so Russian queries
 * also rank English card text (and vice versa), even if the LLM omitted a language.
 */
export function enrichTokensBilingual(tokens: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const skip = new Set([
    "near",
    "shop",
    "car",
    "еда",
    "сад",
    "pet",
  ]);
  for (const token of tokens) {
    const phrase = token.trim().toLowerCase().replace(/\s+/g, " ");
    if (phrase.length < 2 || skip.has(phrase)) continue;
    const candidates =
      phrase.includes(" ")
        ? [phrase, ...phrase.split(/\s+/).flatMap((t) => expandSearchToken(t))]
        : expandSearchToken(phrase);
    for (const c of candidates) {
      const key = c.toLowerCase();
      if (key.length < 3 || skip.has(key) || seen.has(key)) continue;
      if (seen.size >= 28) break;
      seen.add(key);
      out.push(key);
    }
  }
  return out.slice(0, 24);
}

export function enrichSearchIntent(intent: SearchIntent): SearchIntent {
  const mustHints = enrichTokensBilingual([
    ...intent.mustHints,
    ...intent.keywords,
  ]);
  // Keep name/specialty keywords lean; still bilingual-expand them.
  const keywords =
    intent.queryMode === "business_name"
      ? enrichTokensBilingual(intent.keywords).slice(0, 10)
      : enrichTokensBilingual(intent.keywords).slice(0, 12);

  let preferCategory = intent.preferCategory;
  const queryMode = intent.queryMode;

  if (queryMode === "service_need" || queryMode === "browse") {
    preferCategory = true;
  } else if (queryMode === "business_name") {
    preferCategory = false;
  }

  // Named place search must not lock to a wrong category browse.
  const categorySlug =
    queryMode === "business_name" ? null : intent.categorySlug;

  return {
    ...intent,
    keywords:
      queryMode === "service_need" || queryMode === "browse" ? [] : keywords,
    mustHints:
      queryMode === "business_name"
        ? enrichTokensBilingual([...intent.mustHints, ...intent.keywords])
        : mustHints,
    preferCategory,
    queryMode,
    categorySlug,
  };
}

export function normalizeSearchIntent(
  raw: unknown,
  allowedSlugs: Set<string>,
): SearchIntent {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const keywords = asStringArray(obj.keywords);
  const mustHints = asHintArray(obj.mustHints);
  const city = asNullableString(obj.city);
  let preferCategory = asBoolean(obj.preferCategory, false);
  const nearMe = asBoolean(obj.nearMe, false);
  let queryMode = asQueryMode(obj.queryMode, preferCategory);

  // Align flags if model only set one of them.
  if (queryMode === "service_need" || queryMode === "browse") {
    preferCategory = true;
  } else if (queryMode === "business_name") {
    preferCategory = false;
  } else if (preferCategory && queryMode === "specialty") {
    queryMode = "service_need";
  }

  let categorySlug = asNullableString(obj.categorySlug);
  if (categorySlug && !allowedSlugs.has(categorySlug)) {
    categorySlug = null;
  }
  if (queryMode === "business_name") {
    categorySlug = null;
  }

  return enrichSearchIntent({
    keywords,
    city,
    categorySlug,
    mustHints,
    preferCategory,
    nearMe,
    queryMode,
  });
}

function buildSystemPrompt(categories: CategoryHint[]): string {
  const catalog = categories
    .map((c) => `- ${c.slug}: ${c.name}`)
    .join("\n");

  return `You are the search intent parser for КРУГИ.

Return ONLY a JSON object with this exact shape:
{
  "queryMode": "service_need" | "business_name" | "specialty" | "browse",
  "keywords": string[],
  "city": string | null,
  "categorySlug": string | null,
  "mustHints": string[],
  "preferCategory": boolean,
  "nearMe": boolean
}

Critical bilingual rule:
- For every service/need concept the user expressed, put BOTH Russian and English
  forms into mustHints (e.g. ["масло","oil","oil change"] or ["маникюр","manicure","nails"]).
- Never leave mustHints in only one language when a clear translation exists.

Quick mapping of preferCategory:
- service_need / browse → preferCategory=true, keywords=[]
- business_name / specialty → preferCategory=false
- business_name → categorySlug=null

Worked examples (follow the pattern):
1) "поменять масло" →
   {"queryMode":"service_need","keywords":[],"city":null,"categorySlug":"auto","mustHints":["масло","oil","oil change"],"preferCategory":true,"nearMe":false}
2) "oil change Irvine" →
   {"queryMode":"service_need","keywords":[],"city":"Irvine","categorySlug":"auto","mustHints":["oil","oil change","масло"],"preferCategory":true,"nearMe":false}
3) "нужен сантехник рядом" →
   {"queryMode":"service_need","keywords":[],"city":null,"categorySlug":"services","mustHints":["сантехник","plumber","plumbing"],"preferCategory":true,"nearMe":true}
4) "русский маникюр" →
   {"queryMode":"specialty","keywords":["маникюр","manicure"],"city":null,"categorySlug":"beauty","mustHints":["русский","russian","маникюр","manicure","nails"],"preferCategory":false,"nearMe":false}
5) "Калинка" / "Kalinka" →
   {"queryMode":"business_name","keywords":["калинка","kalinka"],"city":null,"categorySlug":null,"mustHints":["калинка","kalinka"],"preferCategory":false,"nearMe":false}
6) "рестораны в Anaheim" →
   {"queryMode":"browse","keywords":[],"city":"Anaheim","categorySlug":"restaurants","mustHints":[],"preferCategory":true,"nearMe":false}
7) "где сделать стрижку" →
   {"queryMode":"service_need","keywords":[],"city":null,"categorySlug":"beauty","mustHints":["стрижка","haircut","hair"],"preferCategory":true,"nearMe":false}
8) "flooring" / "полы" / "ламинат" →
   {"queryMode":"service_need","keywords":[],"city":null,"categorySlug":"services","mustHints":["flooring","полы","ламинат","laminate"],"preferCategory":true,"nearMe":false}
9) "Подскажите где нормальный стоматолог в Айрвине???" →
   {"queryMode":"service_need","keywords":[],"city":"Irvine","categorySlug":"medical","mustHints":["стоматолог","dentist","dental"],"preferCategory":true,"nearMe":false}
10) "manikyur" / "santehnik" →
   {"queryMode":"service_need","keywords":[],"city":null,"categorySlug":"beauty","mustHints":["маникюр","manicure","nails"],"preferCategory":true,"nearMe":false}
   (santehnik → services + plumber/сантехник)
11) "@kalinka_oc" / "instagram.com/anna.beauty" →
   {"queryMode":"business_name","keywords":["kalinka_oc"],"city":null,"categorySlug":null,"mustHints":["kalinka_oc"],"preferCategory":false,"nearMe":false}
12) "СРОЧНО эвакуатор Huntington Beach" →
   {"queryMode":"service_need","keywords":[],"city":"Huntington Beach","categorySlug":"auto","mustHints":["эвакуатор","tow","towing"],"preferCategory":true,"nearMe":false}
13) "need сантехник ASAP near me" →
   {"queryMode":"service_need","keywords":[],"city":null,"categorySlug":"services","mustHints":["сантехник","plumber","plumbing"],"preferCategory":true,"nearMe":true}
14) "муж на час / handyman Costa Mesa" →
   {"queryMode":"service_need","keywords":[],"city":"Costa Mesa","categorySlug":"services","mustHints":["handyman","мастер","ремонт","repair"],"preferCategory":true,"nearMe":false}
15) "переводчик" / "нужен переводчик для суда по Zoom" →
   {"queryMode":"service_need","keywords":[],"city":null,"categorySlug":null,"mustHints":["переводчик","translator","interpreter"],"preferCategory":false,"nearMe":false}
16) "водитель-переводчик" / "chaperone" →
   {"queryMode":"service_need","keywords":[],"city":null,"categorySlug":"services","mustHints":["водитель","chaperone","переводчик","translator"],"preferCategory":true,"nearMe":false}

${SEARCH_CATALOG_PLAYBOOK}

Allowed categories (pick categorySlug ONLY from this list):
${catalog || "(none)"}`;
}

/**
 * Parse a natural-language search query into structured filters via paid search models.
 */
export async function parseSearchIntent(
  query: string,
  categories: CategoryHint[],
): Promise<ParsedSearchIntent> {
  const q = query.trim();
  if (!q) {
    return {
      intent: {
        keywords: [],
        city: null,
        categorySlug: null,
        mustHints: [],
        preferCategory: false,
        nearMe: false,
        queryMode: "specialty",
      },
      modelUsed: "none",
    };
  }

  const allowedSlugs = new Set(categories.map((c) => c.slug));
  const { content, modelUsed } = await completeJsonWithFailover([
    { role: "system", content: buildSystemPrompt(categories) },
    { role: "user", content: q },
  ]);

  let raw: unknown;
  try {
    raw = parseJsonObject(content);
  } catch {
    throw new OpenRouterError("Model returned non-JSON intent", null, true);
  }

  return {
    intent: normalizeSearchIntent(raw, allowedSlugs),
    modelUsed,
  };
}

export { OpenRouterError };
