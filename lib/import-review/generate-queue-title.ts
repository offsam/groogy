/**
 * Short catalog title from post text — used before showing ready_to_publish cards.
 * Server-only; same OpenRouter failover as description translation.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { completeJsonWithFailover } from "@/lib/ai/openrouter";
import { inferNameFromDescription } from "@/lib/import-review/display-name";
import { isUnusableReadyTitle } from "@/lib/import-review/ready-to-publish-gate";

export function titleNeedsGeneratedHeadline(input: {
  title?: string | null;
  business_name?: string | null;
  person_name?: string | null;
  description?: string | null;
  source_text?: string | null;
}): boolean {
  const current =
    (input.title || "").trim() ||
    (input.business_name || "").trim() ||
    (input.person_name || "").trim();
  return isUnusableReadyTitle(current, {
    description: input.description,
    sourceText: input.source_text,
  });
}

export async function generateShortQueueTitle(input: {
  title?: string | null;
  description?: string | null;
  sourceText?: string | null;
}): Promise<string | null> {
  const blob = [input.description, input.sourceText]
    .map((x) => (x || "").trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 2500);
  if (!blob) return null;

  const inferred = inferNameFromDescription(blob);
  if (
    inferred &&
    !isUnusableReadyTitle(inferred, {
      description: blob,
      sourceText: null,
    })
  ) {
    return inferred.slice(0, 80);
  }

  try {
    const { content } = await completeJsonWithFailover(
      [
        {
          role: "system",
          content: [
            "You write short catalog card titles for КРУГИ, a Russian-speaking California directory.",
            'Return ONLY JSON: {"title":"..."}.',
            "Make a short title (2–7 words) from the post: master or business name, or a clear service label.",
            "Russian if the source is Russian. Keep proper nouns.",
            "Do not use Telegram/Instagram usernames, @handles, phones, URLs, or the whole post.",
            "Do not add contacts or a call to action.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            currentTitle: (input.title || "").trim().slice(0, 200),
            text: blob,
          }),
        },
      ],
      { timeoutMs: 6000 },
    );
    let parsed: { title?: unknown } = {};
    try {
      parsed = JSON.parse(content) as { title?: unknown };
    } catch {
      parsed = {};
    }
    const title =
      typeof parsed.title === "string" ? parsed.title.replace(/\s+/g, " ").trim() : "";
    if (
      title &&
      !isUnusableReadyTitle(title, { description: blob, sourceText: null })
    ) {
      return title.slice(0, 80);
    }
  } catch {
    // leave title as-is; caller still shows the card
  }
  return inferred && inferred.length >= 3 ? inferred.slice(0, 80) : null;
}

const TITLE_LLM_BATCH = 4;
const TITLE_LLM_MAX = 12;

type TitleRow = {
  id: string;
  title: string | null;
  business_name: string | null;
  person_name: string | null;
  description: string | null;
  source_text: string | null;
};

/**
 * Persist a short title for ready-queue cards whose name is a username or a post dump.
 * Caps LLM calls so Inbox still renders within the serverless budget.
 */
export async function repairReadyQueueTitles(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any>,
  rows: TitleRow[],
): Promise<Map<string, string>> {
  const rewritten = new Map<string, string>();
  const need = rows.filter((row) => titleNeedsGeneratedHeadline(row));
  if (!need.length) return rewritten;

  const llm: TitleRow[] = [];
  for (const row of need) {
    const blob = [row.description, row.source_text].filter(Boolean).join("\n");
    const inferred = inferNameFromDescription(blob);
    if (
      inferred &&
      !isUnusableReadyTitle(inferred, { description: blob, sourceText: null })
    ) {
      rewritten.set(row.id, inferred.slice(0, 80));
    } else {
      llm.push(row);
    }
  }

  const llmWork = llm.slice(0, TITLE_LLM_MAX);
  for (let i = 0; i < llmWork.length; i += TITLE_LLM_BATCH) {
    const chunk = llmWork.slice(i, i + TITLE_LLM_BATCH);
    const titles = await Promise.all(
      chunk.map((row) =>
        generateShortQueueTitle({
          title: row.title,
          description: row.description,
          sourceText: row.source_text,
        }),
      ),
    );
    chunk.forEach((row, idx) => {
      const next = titles[idx];
      if (next) rewritten.set(row.id, next);
    });
  }

  await Promise.all(
    [...rewritten.entries()].map(async ([id, title]) => {
      const { error } = await client
        .from("import_review_items")
        .update({ title })
        .eq("id", id);
      if (error) rewritten.delete(id);
    }),
  );

  return rewritten;
}
