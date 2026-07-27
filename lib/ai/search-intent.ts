import "server-only";

import {
  completeJsonWithFailover,
  OpenRouterError,
} from "@/lib/ai/openrouter";

export type SearchIntent = {
  keywords: string[];
  city: string | null;
  categorySlug: string | null;
  mustHints: string[];
  /**
   * True for “I need a service” queries (oil change, plumber, manicure…).
   * Search then browses the category and ranks likely matches, instead of
   * requiring every keyword to appear in the card text.
   */
  preferCategory: boolean;
  /** User asked for nearby / “рядом со мной”. */
  nearMe: boolean;
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

export function normalizeSearchIntent(
  raw: unknown,
  allowedSlugs: Set<string>,
): SearchIntent {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const keywords = asStringArray(obj.keywords);
  const mustHints = asHintArray(obj.mustHints);
  const city = asNullableString(obj.city);
  const preferCategory = asBoolean(obj.preferCategory, false);
  const nearMe = asBoolean(obj.nearMe, false);

  let categorySlug = asNullableString(obj.categorySlug);
  if (categorySlug && !allowedSlugs.has(categorySlug)) {
    categorySlug = null;
  }

  return { keywords, city, categorySlug, mustHints, preferCategory, nearMe };
}

function buildSystemPrompt(categories: CategoryHint[]): string {
  const catalog = categories
    .map((c) => `- ${c.slug}: ${c.name}`)
    .join("\n");

  return `You are a search intent parser for КРУГИ — a Russian-speaking business directory in Southern California (Orange County and nearby).

Return ONLY a JSON object with this exact shape:
{
  "keywords": string[],
  "city": string | null,
  "categorySlug": string | null,
  "mustHints": string[],
  "preferCategory": boolean,
  "nearMe": boolean
}

Rules:
- Decide if the user wants a *service need* (do X for me) or a *named business type* search.
- preferCategory=true when the user needs a service that a category of shops typically provides, even if cards may not list that exact phrase.
  Examples that MUST set preferCategory=true:
  - "поменять масло" / "oil change" → categorySlug "auto", mustHints ["масло","oil","oil change"], keywords []
  - "нужен сантехник" → categorySlug "services", mustHints ["сантехник","plumber"], keywords []
  - "починить машину" → categorySlug "auto", mustHints ["ремонт","repair"], keywords []
- preferCategory=false when searching by specialty text that should appear on cards (e.g. "русский маникюр" → keywords ["маникюр"], mustHints ["русский"], category "beauty").
- keywords: only hard text tokens that should match card text when preferCategory=false. Keep empty when preferCategory=true.
- mustHints: specific service/need terms used for ranking likely matches higher (масло, oil change, страховка, детский…).
- city: US city if named (Irvine, Anaheim). null for county/metro/"рядом". Prefer Latin spelling.
- nearMe=true if user says рядом, near me, около меня, поблизости, nearby.
- categorySlug: one of the allowed slugs, or null if unclear.
- Drop filler words (нужен, найти, хочу, мне, со, мной).
- If the query has an obvious English typo for a trade (floring→flooring, pluming→plumbing), use the corrected term in mustHints/keywords.
- Output JSON only, no markdown.

Allowed categories:
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
