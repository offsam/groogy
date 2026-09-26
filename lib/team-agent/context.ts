/**
 * Compact TeamAgentContext builder — bounded history, authoritative decisions only.
 */

import { loadTeamAgentConfig } from "./config";
import { detectPathConflicts } from "./conflicts";
import { listAuthoritativeDecisions } from "./decisions";
import type { RepositoryContextProvider } from "./repository-context";
import { MockRepositoryContextProvider } from "./repository-context";
import type { TeamAgentStore } from "./store-port";
import { isActiveTaskStatus } from "./tasks";
import { lexicalScore, pickUnlinkedMessages } from "./retrieval";
import { inferTopicIds, isGlobalConstraint, isOverviewQuestion } from "./topics";
import type {
  PathConflict,
  TeamAgentContext,
  TeamAgentMember,
  TeamAgentMessage,
  TeamAgentTopic,
} from "./types";

export type BuildContextOptions = {
  conversationId: string;
  requestingMember?: TeamAgentMember | null;
  triggerMessage?: TeamAgentMessage | null;
  repositoryProvider?: RepositoryContextProvider;
  maxMessages?: number;
};

export async function buildTeamAgentContext(
  store: TeamAgentStore,
  opts: BuildContextOptions,
): Promise<TeamAgentContext> {
  const config = loadTeamAgentConfig();
  const maxMessages = opts.maxMessages ?? config.maxContextMessages;
  const repoProvider =
    opts.repositoryProvider ?? new MockRepositoryContextProvider();

  const members = await store.listActiveMembers();

  const memory = await store.listMemory();
  const topics = await store.listTopics();
  const text = opts.triggerMessage?.body ?? "";
  const hasTopics = topics.length > 0;

  let retrieval: TeamAgentContext["retrieval"] = "unscoped";
  let selected: TeamAgentTopic[] = [];

  if (hasTopics && opts.triggerMessage && isOverviewQuestion(text)) {
    retrieval = "overview";
    selected = topics
      .filter((t) => t.status === "active")
      .sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at))
      .slice(0, config.maxOverviewTopics);
  } else if (hasTopics && opts.triggerMessage) {
    const linked = await store.listTopicIdsForSubject({
      messageId: opts.triggerMessage.id,
    });
    const inferred = linked.length
      ? linked
      : await inferTopicIds(store, {
          text,
          replyToMessageId: opts.triggerMessage.reply_to_message_id,
        });
    const byId = new Map(topics.map((t) => [t.id, t]));
    selected = inferred
      .map((id) => byId.get(id))
      .filter((t): t is TeamAgentTopic => Boolean(t))
      .filter((t) => t.status !== "archived" || textIncludesLabel(text, t.title));
    if (selected.length > 0) retrieval = "topic";
  }

  let recentMessages = await store.listRecentMessages(
    opts.conversationId,
    maxMessages,
  );
  let activeDecisions = await listAuthoritativeDecisions(store);
  let allTasks = await store.listTasks();
  let relevantMemory = memory.filter((m) => m.status === "active").slice(-20);

  if (retrieval === "topic" || retrieval === "overview") {
    const messageIds = new Set<string>();
    const relevantMessageIds = new Set<string>();
    const taskIds = new Set<string>();
    const decisionIds = new Set<string>();
    const memoryIds = new Set<string>();
    for (const topic of selected) {
      const links = await store.listSubjectIdsForTopic(topic.id);
      const topicMatches = lexicalScore(text, `${topic.title} ${topic.summary}`) > 0;
      for (const id of links.messageIds) {
        messageIds.add(id);
        if (retrieval !== "overview" || topicMatches) relevantMessageIds.add(id);
      }
      for (const id of links.taskIds) taskIds.add(id);
      for (const id of links.decisionIds) decisionIds.add(id);
      for (const id of links.memoryIds) memoryIds.add(id);
    }
    const allMessages = await store.listRecentMessages(opts.conversationId, 120);
    const linked = allMessages.filter((m) => relevantMessageIds.has(m.id));
    const unlinked = pickUnlinkedMessages(
      allMessages,
      messageIds,
      text,
      opts.triggerMessage?.reply_to_message_id ?? null,
      8,
      opts.triggerMessage?.id,
    );
    const combined = [...linked, ...unlinked.filter((m) => !linked.some((row) => row.id === m.id))];
    recentMessages = combined.slice(-maxMessages);
    if (retrieval === "topic") {
      const humans = allMessages.filter(
        (message) =>
          message.id !== opts.triggerMessage?.id &&
          message.message_type !== "bot" &&
          message.message_type !== "system" &&
          message.external_message_id !== "project-status",
      );
      const extra = humans.slice(-12).filter((message) => !recentMessages.some((row) => row.id === message.id));
      recentMessages = [...recentMessages, ...extra].slice(-maxMessages);
    }
    activeDecisions = activeDecisions.filter((d) => decisionIds.has(d.id));
    allTasks = allTasks.filter((t) => taskIds.has(t.id));
    const topical = memory.filter(
      (m) => m.status === "active" && memoryIds.has(m.id),
    );
    const globalConstraints = memory.filter(
      (m) => isGlobalConstraint(m) && !memoryIds.has(m.id),
    );
    relevantMemory = [...topical, ...globalConstraints].slice(-20);
  }

  const topicSummaries = selected
    .filter((t) => t.status !== "archived")
    .map((t) => `${t.title}: ${t.summary || "(без summary)"}`);

  const allActiveTasks = allTasks.filter((t) => isActiveTaskStatus(t.status));
  const blockedTasks = allActiveTasks.filter((t) => t.status === "blocked");

  const potentialConflicts: PathConflict[] = [];
  for (let i = 0; i < allActiveTasks.length; i++) {
    for (let j = i + 1; j < allActiveTasks.length; j++) {
      const report = detectPathConflicts(
        allActiveTasks[i].scope_paths,
        allActiveTasks[j].scope_paths,
      );
      potentialConflicts.push(...report.overlaps);
    }
  }

  const openQuestions = recentMessages
    .filter((m) => m.body.includes("?"))
    .map((m) => m.body.slice(0, 200))
    .slice(-10);

  return {
    requestingMember: opts.requestingMember ?? null,
    members,
    recentMessages,
    activeDecisions,
    activeTasks: allActiveTasks,
    blockedTasks,
    relevantMemory,
    repository: await Promise.resolve(repoProvider.getContext()),
    potentialConflicts,
    openQuestions,
    topics: selected.filter((t) => t.status !== "archived"),
    topicSummaries,
    retrieval,
    projectLines: [],
  };
}

function textIncludesLabel(text: string, label: string): boolean {
  const needle = label.trim().toLowerCase();
  if (needle.length < 3) return false;
  return text.toLowerCase().includes(needle);
}
