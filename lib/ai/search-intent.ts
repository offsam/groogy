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

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeSearchIntent(
  raw: unknown,
  allowedSlugs: Set<string>,
): SearchIntent {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const keywords = asStringArray(obj.keywords);
  const mustHints = asStringArray(obj.mustHints);
  const city = asNullableString(obj.city);

  let categorySlug = asNullableString(obj.categorySlug);
  if (categorySlug && !allowedSlugs.has(categorySlug)) {
    categorySlug = null;
  }

  return { keywords, city, categorySlug, mustHints };
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
  "mustHints": string[]
}

Rules:
- keywords: 1–6 short search tokens (Russian or English) for the service/business type only (e.g. стоматолог, ресторан). Drop filler words (в, на, который, нужен, найди, etc.). Do NOT put city names or soft requirements into keywords.
- city: US city name if mentioned (e.g. Irvine, Anaheim, Tustin). null if not mentioned. Prefer English/Latin spelling for California cities.
- categorySlug: must be one of the allowed slugs below, or null if unclear.
- mustHints: optional soft requirements (e.g. страховка, детский, 24/7) used only for ranking — never duplicate them in keywords.
- Do not invent places or categories not supported by the query.
- Output JSON only, no markdown.

Allowed categories:
${catalog || "(none)"}`;
}

/**
 * Parse a natural-language search query into structured filters via OpenRouter free models.
 */
export async function parseSearchIntent(
  query: string,
  categories: CategoryHint[],
): Promise<ParsedSearchIntent> {
  const q = query.trim();
  if (!q) {
    return {
      intent: { keywords: [], city: null, categorySlug: null, mustHints: [] },
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
