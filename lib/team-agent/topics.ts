/**
 * Topic / memory packets. Organizes existing messages, tasks, decisions, and memory.
 * Does not call an LLM and does not rewrite raw chat history.
 */

import type { TeamAgentStore } from "./store-port";
import type {
  TeamAgentMemory,
  TeamAgentMessage,
  TeamAgentTopic,
  TeamAgentTopicStatus,
} from "./types";

export function slugifyTopicTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "topic";
}

function aliasesOf(topic: TeamAgentTopic): string[] {
  const raw = topic.metadata.aliases;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

export async function createTopic(
  store: TeamAgentStore,
  input: { title: string; summary?: string; status?: TeamAgentTopicStatus },
): Promise<TeamAgentTopic> {
  const title = input.title.trim();
  let slug = slugifyTopicTitle(title);
  const existing = await store.listTopics();
  if (existing.some((t) => t.slug === slug)) {
    slug = `${slug}-${existing.length + 1}`;
  }
  const now = new Date().toISOString();
  return store.upsertTopic({
    title,
    slug,
    summary: input.summary?.trim() ?? "",
    status: input.status ?? "active",
    last_activity_at: now,
    metadata: {},
  });
}

export async function renameTopic(
  store: TeamAgentStore,
  topicId: string,
  title: string,
): Promise<TeamAgentTopic> {
  const topic = (await store.listTopics()).find((t) => t.id === topicId);
  if (!topic) throw new Error(`topic not found: ${topicId}`);
  const aliases = Array.from(new Set([...aliasesOf(topic), topic.title, topic.slug]));
  return store.upsertTopic({
    ...topic,
    title: title.trim(),
    slug: topic.slug,
    metadata: { ...topic.metadata, aliases },
    last_activity_at: new Date().toISOString(),
  });
}

export async function archiveTopic(
  store: TeamAgentStore,
  topicId: string,
): Promise<TeamAgentTopic> {
  const topic = (await store.listTopics()).find((t) => t.id === topicId);
  if (!topic) throw new Error(`topic not found: ${topicId}`);
  return store.upsertTopic({
    ...topic,
    status: "archived",
    last_activity_at: new Date().toISOString(),
  });
}

export async function setTopicSummary(
  store: TeamAgentStore,
  topicId: string,
  summary: string,
): Promise<TeamAgentTopic> {
  const topic = (await store.listTopics()).find((t) => t.id === topicId);
  if (!topic) throw new Error(`topic not found: ${topicId}`);
  return store.upsertTopic({
    ...topic,
    summary: summary.trim().slice(0, 4000),
    last_activity_at: new Date().toISOString(),
    metadata: {
      ...topic.metadata,
      summary_updated_at: new Date().toISOString(),
      summary_source: "derived",
      summary_version: Number(topic.metadata.summary_version ?? 0) + 1,
    },
  });
}

/**
 * Move every message/task/decision/memory link from source onto target, then archive source.
 * Raw rows are not deleted.
 */
export async function mergeTopics(
  store: TeamAgentStore,
  sourceId: string,
  targetId: string,
): Promise<{ source: TeamAgentTopic; target: TeamAgentTopic }> {
  if (sourceId === targetId) throw new Error("cannot merge a topic into itself");
  const topics = await store.listTopics();
  const source = topics.find((t) => t.id === sourceId);
  const target = topics.find((t) => t.id === targetId);
  if (!source || !target) throw new Error("merge requires two existing topics");
  await store.rewireTopicLinks(sourceId, targetId);
  const archived = await store.upsertTopic({
    ...source,
    status: "archived",
    metadata: {
      ...source.metadata,
      merged_into: targetId,
    },
    last_activity_at: new Date().toISOString(),
  });
  const updatedTarget = await store.upsertTopic({
    ...target,
    metadata: {
      ...target.metadata,
      aliases: Array.from(
        new Set([
          ...aliasesOf(target),
          source.title,
          source.slug,
          ...aliasesOf(source),
        ]),
      ),
    },
    last_activity_at: new Date().toISOString(),
  });
  return { source: archived, target: updatedTarget };
}

export async function linkMessageToTopics(
  store: TeamAgentStore,
  messageId: string,
  topicIds: string[],
): Promise<void> {
  for (const topicId of topicIds) {
    await store.linkSubjectToTopic({ topicId, messageId });
  }
}

export async function linkTaskToTopic(
  store: TeamAgentStore,
  taskId: string,
  topicId: string,
): Promise<void> {
  await store.linkSubjectToTopic({ topicId, taskId });
}

export async function linkDecisionToTopic(
  store: TeamAgentStore,
  decisionId: string,
  topicId: string,
): Promise<void> {
  await store.linkSubjectToTopic({ topicId, decisionId });
}

export async function linkMemoryToTopic(
  store: TeamAgentStore,
  memoryId: string,
  topicId: string,
): Promise<void> {
  await store.linkSubjectToTopic({ topicId, memoryId });
}

function textIncludesLabel(text: string, label: string): boolean {
  const needle = label.trim().toLowerCase();
  if (needle.length < 3) return false;
  return text.toLowerCase().includes(needle);
}

export function isOverviewQuestion(text: string): boolean {
  return /что\s+(мы\s+)?обсуждали|какие\s+темы|что\s+у\s+нас\s+вообще|дай\s+статус\s+проекта|what\s+did\s+we\s+discuss/i.test(
    text,
  );
}

export async function getTopicById(
  store: TeamAgentStore,
  id: string,
): Promise<TeamAgentTopic | null> {
  return (await store.listTopics()).find((t) => t.id === id) ?? null;
}

export async function findTopicBySlug(
  store: TeamAgentStore,
  slug: string,
): Promise<TeamAgentTopic | null> {
  return (await store.listTopics()).find((t) => t.slug === slug) ?? null;
}

export async function listActiveTopics(
  store: TeamAgentStore,
): Promise<TeamAgentTopic[]> {
  return (await store.listTopics()).filter((t) => t.status === "active");
}

export function isGlobalConstraint(memory: TeamAgentMemory): boolean {
  if (memory.status !== "active") return false;
  if (memory.category !== "constraint" && memory.memory_type !== "constraint") {
    return false;
  }
  return memory.metadata.critical === true || memory.metadata.scope === "global";
}

/**
 * Deterministic topic guess. Never creates topics and never calls a model.
 * Archived topics match only when the text names them exactly.
 */
export async function inferTopicIds(
  store: TeamAgentStore,
  input: { text: string; replyToMessageId?: string | null },
): Promise<string[]> {
  const topics = await store.listTopics();
  const found = new Set<string>();

  if (input.replyToMessageId) {
    const parentTopics = await store.listTopicIdsForSubject({
      messageId: input.replyToMessageId,
    });
    for (const id of parentTopics) {
      const topic = topics.find((t) => t.id === id);
      if (topic && topic.status !== "archived") found.add(id);
    }
  }

  for (const topic of topics) {
    const labels = [topic.title, topic.slug, ...aliasesOf(topic)];
    const named = labels.some((label) => textIncludesLabel(input.text, label));
    if (!named) continue;
    if (topic.status === "archived") {
      found.add(topic.id);
      continue;
    }
    if (topic.status === "active" || topic.status === "dormant") found.add(topic.id);
  }

  const tasks = await store.listTasks();
  for (const task of tasks) {
    if (!textIncludesLabel(input.text, task.title)) continue;
    const topicIds = await store.listTopicIdsForSubject({ taskId: task.id });
    for (const id of topicIds) {
      const topic = topics.find((t) => t.id === id);
      if (topic && topic.status !== "archived") found.add(id);
    }
  }

  return [...found];
}

/** Used on explicit invocation only. Passive ingest must not call this. */
export async function linkInferredTopics(
  store: TeamAgentStore,
  message: Pick<TeamAgentMessage, "id" | "body" | "reply_to_message_id">,
): Promise<string[]> {
  const topicIds = await inferTopicIds(store, {
    text: message.body,
    replyToMessageId: message.reply_to_message_id,
  });
  await linkMessageToTopics(store, message.id, topicIds);
  return topicIds;
}
