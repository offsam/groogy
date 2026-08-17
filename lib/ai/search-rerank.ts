import "server-only";

import { completeJsonWithFailover } from "@/lib/ai/openrouter";
import type { Business } from "@/types/business";

const MAX_CANDIDATES = 36;
const MAX_KEEP = 12;
const MAX_SIMILAR = 8;
const RERANK_TIMEOUT_MS = 8_000;

export type SearchRerankResult = {
  keep: Business[];
  similar: Business[];
  modelUsed: string;
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

function asIdList(value: unknown, allowed: Set<string>, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}

function cardBlurb(business: Business): string {
  const raw = (business.shortDescription || business.description || "")
    .replace(/\s+/g, " ")
    .trim();
  return raw.slice(0, 140);
}

/**
 * Second cheap LLM pass: pick which retrieved cards actually match the query.
 * Fail-open — caller keeps heuristic ranking if this returns null.
 */
export async function rerankSearchMatches(
  query: string,
  candidates: Business[],
): Promise<SearchRerankResult | null> {
  const pool = candidates.slice(0, MAX_CANDIDATES);
  if (pool.length < 2) return null;

  const byId = new Map(pool.map((b) => [b.id, b]));
  const allowed = new Set(byId.keys());
  const lines = pool.map((b, i) => {
    const blurb = cardBlurb(b);
    return `${i + 1}. ${b.id} | ${b.name} | ${b.categoryName ?? "—"} | ${blurb || "—"}`;
  });

  const { content, modelUsed } = await completeJsonWithFailover(
    [
      {
        role: "system",
        content: `You select КРУГИ directory cards for one user query.
Return ONLY JSON: {"keep":["id"],"similar":["id"]}
keep = same job/service the user asked for. similar = related but a different profession.
Omit unrelated cards. Use only ids from the list. Best first.
Max ${MAX_KEEP} keep, ${MAX_SIMILAR} similar.
Rules:
- Водитель-переводчик / chaperone / driver's services is NOT a translator.
- Language courses / tutored English is NOT a translator.
- A generic lawyer is NOT a translator unless the card offers translation/interpreting.
- A nail/beauty studio is NOT ballet/dance.
- Prefer cards whose name or about-text is the requested trade.`,
      },
      {
        role: "user",
        content: `Query: ${query.trim().slice(0, 400)}\n\nCards:\n${lines.join("\n")}`,
      },
    ],
    { timeoutMs: RERANK_TIMEOUT_MS },
  );

  let raw: unknown;
  try {
    raw = parseJsonObject(content);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;

  const rec = raw as { keep?: unknown; similar?: unknown };
  const keepIds = asIdList(rec.keep, allowed, MAX_KEEP);
  const similarIds = asIdList(rec.similar, allowed, MAX_SIMILAR).filter(
    (id) => !keepIds.includes(id),
  );
  if (keepIds.length === 0 && similarIds.length === 0) return null;

  return {
    keep: keepIds.map((id) => byId.get(id)!).filter(Boolean),
    similar: similarIds.map((id) => byId.get(id)!).filter(Boolean),
    modelUsed,
  };
}
