/**
 * Optional cheap LLM for «Разбор» lane only.
 * Returns a lane action suggestion — never invents contacts into narrative.
 * Never runs enrich itself — action "enrich" is a proposal for a later step.
 */

import "server-only";

import type { AdminLaneId } from "@/lib/admin/lanes/types";

export type LaneLlmAction =
  | "attach"
  | "route_entity"
  | "seeking"
  | "ready"
  | "quarantine"
  | "enrich"
  | "needs_human";

export type LaneLlmSuggestion = {
  action: LaneLlmAction;
  lane: AdminLaneId;
  entityType?: string | null;
  targetCollection?: string | null;
  reason: string;
  confidence: number;
  model?: string;
};

const ACTION_TO_LANE: Record<LaneLlmAction, AdminLaneId> = {
  attach: "attach",
  route_entity: "route",
  seeking: "seeking",
  ready: "ready",
  quarantine: "quarantine",
  enrich: "route",
  needs_human: "review",
};

/** Same cheap paid chain idea as lib/ai/openrouter.ts; free always last (402-safe). */
const CHEAP_PAID_MODELS = [
  "openai/gpt-4.1-nano",
  "google/gemini-2.5-flash-lite",
  "amazon/nova-micro-v1",
] as const;

const FREE_FALLBACK_MODELS = [
  "openrouter/free",
  "google/gemma-4-31b-it:free",
  "openai/gpt-oss-20b:free",
] as const;

function modelChain(): string[] {
  const fromEnv = (process.env.OPENROUTER_CHEAP_MODELS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const paid = fromEnv.length > 0 ? fromEnv : [...CHEAP_PAID_MODELS];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of [...paid, ...FREE_FALLBACK_MODELS]) {
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function buildLaneTriagePrompt(input: {
  text: string;
  title?: string | null;
}): string {
  return `You triage Russian diaspora California directory queue posts.
Return ONLY JSON:
{"action":"attach|route_entity|seeking|ready|quarantine|enrich|needs_human","entityType":"business|private_specialist|marketplace_listing|job|event|real_estate|lechu_listing|transfer_listing|null","targetCollection":"businesses|private_specialists|marketplace|jobs|events|real_estate|lechu|transfers|null","reason":"short","confidence":0.0}
Rules:
- seeking = demand («ищу…»), not a seller offer
- attach = recommendation for an existing business/person, not a new card
- quarantine = empty spam / no recoverable catalog value
- route_entity = clear section, structured enough to type, enrich not urgent
- enrich = recoverable offer but missing category/description/contacts to extract from text
- ready = has name + contact + clear type, publishable soon
- needs_human = unclear
- Never invent phone/email/address
Title: ${input.title || ""}
Text:
${(input.text || "").slice(0, 2500)}`;
}

/**
 * Classify a review-lane blob with the cheapest available OpenRouter model.
 * Returns null when no API key / parse failure — caller keeps needs_human.
 */
export async function llmSuggestLane(input: {
  text: string;
  title?: string | null;
}): Promise<LaneLlmSuggestion | null> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) return null;

  const prompt = buildLaneTriagePrompt(input);
  const models = modelChain();

  for (const model of models) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://krugi.app",
          "X-Title": "KRUGI admin lanes",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 220,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content || "";
      const parsed = extractJsonObject(content);
      if (!parsed) continue;
      const action = String(
        parsed.action || "needs_human",
      ) as LaneLlmAction;
      if (!(action in ACTION_TO_LANE)) continue;
      return {
        action,
        lane: ACTION_TO_LANE[action],
        entityType:
          typeof parsed.entityType === "string" ? parsed.entityType : null,
        targetCollection:
          typeof parsed.targetCollection === "string"
            ? parsed.targetCollection
            : null,
        reason: String(parsed.reason || model).slice(0, 200),
        confidence: Math.max(
          0,
          Math.min(1, Number(parsed.confidence ?? 0.5)),
        ),
        model,
      };
    } catch {
      continue;
    }
  }
  return null;
}
