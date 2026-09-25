/**
 * Topic selection for explicit invocations only.
 * The default classifier is local. It is not an extra model call.
 */

import { loadTeamAgentConfig } from "./config";
import type { TeamAgentStore } from "./store-port";
import {
  createTopic,
  findTopicBySlug,
  linkMessageToTopics,
  slugifyTopicTitle,
} from "./topics";
import type {
  SuggestedTopic,
  TeamAgentMessage,
  TeamAgentTopic,
  TopicCandidate,
  TopicClassificationResult,
  TopicSelection,
} from "./types";

const TRANSIENT =
  /^(тест|привет|что нового|ответь|проверка бота|что думаешь|hi|hello|webhook test)[.!?\s]*$/i;

const STOP = new Set([
  "что",
  "как",
  "для",
  "это",
  "или",
  "the",
  "and",
  "бот",
]);

export type TopicClassifyInput = {
  text: string;
  candidates: TopicCandidate[];
  inheritedTopicIds: string[];
};

export interface TopicClassifier {
  calls: number;
  classify(input: TopicClassifyInput): Promise<TopicClassificationResult> | TopicClassificationResult;
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOP.has(t));
}

export function topicSimilarity(text: string, topic: Pick<TeamAgentTopic, "title" | "slug" | "summary">): number {
  const left = tokens(`${text}`);
  const right = new Set(tokens(`${topic.title} ${topic.slug.replace(/-/g, " ")} ${topic.summary}`));
  if (left.length === 0 || right.size === 0) return 0;
  const shared = left.filter((token) => right.has(token));
  if (shared.some((token) => token.length >= 6)) return Math.max(0.5, shared.length / Math.min(left.length, right.size));
  return shared.length / Math.min(left.length, right.size);
}

export function isTransientTopicText(text: string): boolean {
  return TRANSIENT.test(text.trim());
}

export class DeterministicTopicClassifier implements TopicClassifier {
  calls = 0;

  classify(input: TopicClassifyInput): TopicClassificationResult {
    this.calls += 1;
    const ranked = input.candidates
      .map((topic) => ({ topic, score: topicSimilarity(input.text, topic) }))
      .filter((row) => row.score >= 0.5)
      .sort((a, b) => b.score - a.score);

    const selected = new Set<string>(input.inheritedTopicIds);
    for (const row of ranked) selected.add(row.topic.id);

    const suggestedNewTopics: SuggestedTopic[] = [];
    const blocked = /(?:^|[^\p{L}])(тест|test|webhook|привет|ping|hello)(?=$|[^\p{L}])/iu.test(input.text);
    if (selected.size === 0 && !isTransientTopicText(input.text) && !blocked) {
      const words = tokens(input.text);
      if (words.length >= 2) {
        suggestedNewTopics.push({
          title: words.slice(0, 4).join(" "),
          reason: "no existing topic matched",
        });
      }
    }

    const ids = [...selected];
    return {
      selectedTopicIds: ids,
      primaryTopicId: ids[0],
      suggestedNewTopics,
      reasoningSummary: ids.length
        ? "matched existing topics"
        : suggestedNewTopics.length
          ? "no existing topic"
          : "no topic",
    };
  }
}

/** Ready for a future provider. Not called by the webhook path. */
export class LLMTopicClassifier implements TopicClassifier {
  calls = 0;
  classify(): TopicClassificationResult {
    this.calls += 1;
    throw new Error("LLMTopicClassifier is not used; topic hints stay inside the single provider response");
  }
}

export async function prefilterTopicCandidates(
  store: TeamAgentStore,
  inheritedTopicIds: string[],
  text = "",
): Promise<TopicCandidate[]> {
  const config = loadTeamAgentConfig();
  const topics = await store.listTopics();
  const active = topics.filter((t) => t.status === "active");
  const inherited = topics.filter((t) => inheritedTopicIds.includes(t.id));
  const namedArchived = topics.filter(
    (t) => t.status === "archived" && topicSimilarity(text, t) >= 0.5,
  );
  const pool = [...inherited, ...namedArchived, ...active];
  const seen = new Set<string>();
  const unique = pool.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
  return unique.slice(0, config.maxTopicCandidates).map((t) => ({
    id: t.id,
    title: t.title,
    slug: t.slug,
    summary: t.summary,
    status: t.status,
  }));
}

export async function resolveInvocationTopics(
  store: TeamAgentStore,
  message: Pick<TeamAgentMessage, "id" | "body" | "reply_to_message_id">,
  classifier: TopicClassifier = new DeterministicTopicClassifier(),
): Promise<TopicSelection & { classifier: TopicClassifier; result: TopicClassificationResult }> {
  const config = loadTeamAgentConfig();
  const inherited = message.reply_to_message_id
    ? await store.listTopicIdsForSubject({ messageId: message.reply_to_message_id })
    : [];
  const candidates = await prefilterTopicCandidates(store, inherited, message.body);
  const result = await classifier.classify({
    text: message.body,
    candidates,
    inheritedTopicIds: inherited.filter((id) =>
      candidates.some((c) => c.id === id) || inherited.includes(id),
    ),
  });

  const known = new Set((await store.listTopics()).map((t) => t.id));
  const selected: string[] = [];
  for (const id of [...inherited, ...result.selectedTopicIds]) {
    if (!known.has(id) || selected.includes(id)) continue;
    selected.push(id);
    if (selected.length >= config.maxSelectedTopics) break;
  }

  let createdTopicId: string | null = null;
  if (
    selected.length === 0 &&
    result.suggestedNewTopics.length > 0 &&
    !isTransientTopicText(message.body)
  ) {
    const suggestion = result.suggestedNewTopics[0];
    const slug = slugifyTopicTitle(suggestion.title);
    const existing = await findTopicBySlug(store, slug);
    if (existing && existing.status !== "archived") {
      selected.push(existing.id);
    } else if (existing) {
      // archived slug stays unique; do not recreate
    } else {
      const created = await createTopic(store, {
        title: suggestion.title,
        summary: suggestion.description ?? "",
      });
      createdTopicId = created.id;
      selected.push(created.id);
    }
  }

  const capped = selected.slice(0, config.maxSelectedTopics);
  await linkMessageToTopics(store, message.id, capped);

  return {
    primaryTopicId: capped[0] ?? null,
    secondaryTopicIds: capped.slice(1),
    createdTopicId,
    classifier,
    result: {
      ...result,
      selectedTopicIds: capped,
      primaryTopicId: capped[0],
    },
  };
}
