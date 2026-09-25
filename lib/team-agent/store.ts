/**
 * In-memory Team Agent store for V1 tests/simulator (no remote DB required).
 * Mirrors team_agent_* schema semantics.
 */

import { randomUUID } from "node:crypto";
import type { TeamAgentStore } from "./store-port";
import type {
  TeamAgentApproval,
  TeamAgentConversation,
  TeamAgentDecision,
  TeamAgentGitActivity,
  TeamAgentMember,
  TeamAgentMemory,
  TeamAgentMessage,
  TeamAgentSourceType,
  TeamAgentTask,
  TeamAgentTopic,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

type TopicLinkKind = "message" | "task" | "decision" | "memory";

export type TeamAgentStoreSnapshot = {
  members: TeamAgentMember[];
  conversations: TeamAgentConversation[];
  messages: TeamAgentMessage[];
  decisions: TeamAgentDecision[];
  tasks: TeamAgentTask[];
  gitActivity: TeamAgentGitActivity[];
  memory: TeamAgentMemory[];
  approvals: TeamAgentApproval[];
  topics: TeamAgentTopic[];
};

export class InMemoryTeamAgentStore implements TeamAgentStore {
  members = new Map<string, TeamAgentMember>();
  conversations = new Map<string, TeamAgentConversation>();
  messages = new Map<string, TeamAgentMessage>();
  decisions = new Map<string, TeamAgentDecision>();
  tasks = new Map<string, TeamAgentTask>();
  gitActivity = new Map<string, TeamAgentGitActivity>();
  memory = new Map<string, TeamAgentMemory>();
  approvals = new Map<string, TeamAgentApproval>();
  topics = new Map<string, TeamAgentTopic>();
  topicLinks = new Set<string>();

  clear(): void {
    this.members.clear();
    this.conversations.clear();
    this.messages.clear();
    this.decisions.clear();
    this.tasks.clear();
    this.gitActivity.clear();
    this.memory.clear();
    this.approvals.clear();
    this.topics.clear();
    this.topicLinks.clear();
  }

  snapshot(): TeamAgentStoreSnapshot {
    return {
      members: [...this.members.values()],
      conversations: [...this.conversations.values()],
      messages: [...this.messages.values()],
      decisions: [...this.decisions.values()],
      tasks: [...this.tasks.values()],
      gitActivity: [...this.gitActivity.values()],
      memory: [...this.memory.values()],
      approvals: [...this.approvals.values()],
      topics: [...this.topics.values()],
    };
  }

  upsertMember(
    input: Omit<TeamAgentMember, "id" | "created_at" | "updated_at"> & {
      id?: string;
    },
  ): TeamAgentMember {
    const ts = nowIso();
    const id = input.id ?? randomUUID();
    const existing = this.members.get(id);
    const row: TeamAgentMember = {
      ...input,
      id,
      created_at: existing?.created_at ?? ts,
      updated_at: ts,
    };
    this.members.set(id, row);
    return row;
  }

  findMemberByTelegramUserId(telegramUserId: number): TeamAgentMember | null {
    for (const m of this.members.values()) {
      if (m.telegram_user_id === telegramUserId && m.is_active) return m;
    }
    return null;
  }

  findMemberByTelegramUsername(username: string): TeamAgentMember | null {
    const u = username.replace(/^@/, "").toLowerCase();
    for (const m of this.members.values()) {
      if (
        m.telegram_username &&
        m.telegram_username.replace(/^@/, "").toLowerCase() === u &&
        m.is_active
      ) {
        return m;
      }
    }
    return null;
  }

  listActiveMembers(): TeamAgentMember[] {
    return [...this.members.values()].filter((m) => m.is_active);
  }

  findOrCreateConversation(input: {
    source_type: TeamAgentSourceType;
    external_conversation_id: string | null;
    title?: string;
  }): TeamAgentConversation {
    if (input.external_conversation_id) {
      for (const c of this.conversations.values()) {
        if (
          c.source_type === input.source_type &&
          c.external_conversation_id === input.external_conversation_id
        ) {
          return c;
        }
      }
    }
    const ts = nowIso();
    const row: TeamAgentConversation = {
      id: randomUUID(),
      source_type: input.source_type,
      external_conversation_id: input.external_conversation_id,
      title: input.title ?? "Team chat",
      is_active: true,
      created_at: ts,
      updated_at: ts,
    };
    this.conversations.set(row.id, row);
    return row;
  }

  findMessageByExternal(
    conversationId: string,
    externalMessageId: string,
  ): TeamAgentMessage | null {
    for (const m of this.messages.values()) {
      if (
        m.conversation_id === conversationId &&
        m.external_message_id === externalMessageId
      ) {
        return m;
      }
    }
    return null;
  }

  insertMessage(
    input: Omit<TeamAgentMessage, "id" | "created_at"> & { id?: string },
  ): TeamAgentMessage {
    if (input.external_message_id) {
      const dup = this.findMessageByExternal(
        input.conversation_id,
        input.external_message_id,
      );
      if (dup) return dup;
    }
    const row: TeamAgentMessage = {
      ...input,
      id: input.id ?? randomUUID(),
      created_at: nowIso(),
    };
    this.messages.set(row.id, row);
    return row;
  }

  updateMessage(
    id: string,
    patch: Partial<
      Pick<TeamAgentMessage, "body" | "metadata" | "message_type" | "occurred_at">
    >,
  ): TeamAgentMessage {
    const existing = this.messages.get(id);
    if (!existing) throw new Error(`message not found: ${id}`);
    const row: TeamAgentMessage = {
      ...existing,
      ...patch,
      metadata: patch.metadata
        ? { ...existing.metadata, ...patch.metadata }
        : existing.metadata,
      id,
    };
    this.messages.set(id, row);
    return row;
  }

  listRecentMessages(
    conversationId: string,
    limit: number,
  ): TeamAgentMessage[] {
    return [...this.messages.values()]
      .filter((m) => m.conversation_id === conversationId)
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
      .slice(-limit);
  }

  getDecision(id: string): TeamAgentDecision | null {
    return this.decisions.get(id) ?? null;
  }

  upsertDecision(
    input: Omit<TeamAgentDecision, "id" | "created_at" | "updated_at"> & {
      id?: string;
    },
  ): TeamAgentDecision {
    const ts = nowIso();
    const id = input.id ?? randomUUID();
    const existing = this.decisions.get(id);
    const row: TeamAgentDecision = {
      ...input,
      id,
      created_at: existing?.created_at ?? ts,
      updated_at: ts,
    };
    this.decisions.set(id, row);
    return row;
  }

  listDecisions(): TeamAgentDecision[] {
    return [...this.decisions.values()];
  }

  upsertTask(
    input: Omit<TeamAgentTask, "id" | "created_at" | "updated_at"> & {
      id?: string;
    },
  ): TeamAgentTask {
    const ts = nowIso();
    const id = input.id ?? randomUUID();
    const existing = this.tasks.get(id);
    const row: TeamAgentTask = {
      ...input,
      id,
      created_at: existing?.created_at ?? ts,
      updated_at: ts,
    };
    this.tasks.set(id, row);
    return row;
  }

  getTask(id: string): TeamAgentTask | null {
    return this.tasks.get(id) ?? null;
  }

  listTasks(): TeamAgentTask[] {
    return [...this.tasks.values()];
  }

  upsertMemory(
    input: Omit<TeamAgentMemory, "id" | "created_at" | "updated_at"> & {
      id?: string;
    },
  ): TeamAgentMemory {
    const ts = nowIso();
    const id = input.id ?? randomUUID();
    const existing = this.memory.get(id);
    const row: TeamAgentMemory = {
      ...input,
      id,
      category: input.category ?? existing?.category ?? null,
      metadata: input.metadata ?? existing?.metadata ?? {},
      created_at: existing?.created_at ?? ts,
      updated_at: ts,
    };
    this.memory.set(id, row);
    return row;
  }

  listMemory(): TeamAgentMemory[] {
    return [...this.memory.values()];
  }

  getApproval(id: string): TeamAgentApproval | null {
    return this.approvals.get(id) ?? null;
  }

  insertApproval(
    input: Omit<TeamAgentApproval, "id" | "created_at" | "decided_at"> & {
      id?: string;
      decided_at?: string | null;
    },
  ): TeamAgentApproval {
    const row: TeamAgentApproval = {
      ...input,
      id: input.id ?? randomUUID(),
      created_at: nowIso(),
      decided_at: input.decided_at ?? null,
    };
    this.approvals.set(row.id, row);
    return row;
  }

  updateApproval(id: string, patch: Partial<TeamAgentApproval>): TeamAgentApproval {
    const existing = this.approvals.get(id);
    if (!existing) throw new Error(`approval not found: ${id}`);
    const row = { ...existing, ...patch, id };
    this.approvals.set(id, row);
    return row;
  }

  listApprovals(): TeamAgentApproval[] {
    return [...this.approvals.values()];
  }

  upsertTopic(
    input: Omit<TeamAgentTopic, "id" | "created_at" | "updated_at"> & {
      id?: string;
    },
  ): TeamAgentTopic {
    const ts = nowIso();
    const id = input.id ?? randomUUID();
    const existing = this.topics.get(id);
    const row: TeamAgentTopic = {
      ...input,
      id,
      created_at: existing?.created_at ?? ts,
      updated_at: ts,
    };
    this.topics.set(id, row);
    return row;
  }

  listTopics(): TeamAgentTopic[] {
    return [...this.topics.values()];
  }

  getTopicById(id: string): TeamAgentTopic | null {
    return this.topics.get(id) ?? null;
  }

  findTopicBySlug(slug: string): TeamAgentTopic | null {
    return this.listTopics().find((t) => t.slug === slug) ?? null;
  }

  listActiveTopics(): TeamAgentTopic[] {
    return this.listTopics().filter((t) => t.status === "active");
  }

  private linkKey(kind: TopicLinkKind, subjectId: string, topicId: string): string {
    return `${kind}:${subjectId}:${topicId}`;
  }

  linkSubjectToTopic(input: {
    topicId: string;
    messageId?: string;
    taskId?: string;
    decisionId?: string;
    memoryId?: string;
  }): void {
    const pairs: Array<[TopicLinkKind, string | undefined]> = [
      ["message", input.messageId],
      ["task", input.taskId],
      ["decision", input.decisionId],
      ["memory", input.memoryId],
    ];
    for (const [kind, subjectId] of pairs) {
      if (!subjectId) continue;
      this.topicLinks.add(this.linkKey(kind, subjectId, input.topicId));
    }
  }

  listTopicIdsForSubject(input: {
    messageId?: string;
    taskId?: string;
    decisionId?: string;
    memoryId?: string;
  }): string[] {
    const kind: TopicLinkKind | null = input.messageId
      ? "message"
      : input.taskId
        ? "task"
        : input.decisionId
          ? "decision"
          : input.memoryId
            ? "memory"
            : null;
    const subjectId =
      input.messageId ?? input.taskId ?? input.decisionId ?? input.memoryId;
    if (!kind || !subjectId) return [];
    const prefix = `${kind}:${subjectId}:`;
    return [...this.topicLinks]
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
  }

  listSubjectIdsForTopic(topicId: string): {
    messageIds: string[];
    taskIds: string[];
    decisionIds: string[];
    memoryIds: string[];
  } {
    const out = {
      messageIds: [] as string[],
      taskIds: [] as string[],
      decisionIds: [] as string[],
      memoryIds: [] as string[],
    };
    for (const key of this.topicLinks) {
      const kindEnd = key.indexOf(":");
      const kind = key.slice(0, kindEnd);
      const rest = key.slice(kindEnd + 1);
      const suffix = `:${topicId}`;
      if (!rest.endsWith(suffix)) continue;
      const subjectId = rest.slice(0, -suffix.length);
      if (!subjectId) continue;
      if (kind === "message") out.messageIds.push(subjectId);
      if (kind === "task") out.taskIds.push(subjectId);
      if (kind === "decision") out.decisionIds.push(subjectId);
      if (kind === "memory") out.memoryIds.push(subjectId);
    }
    return out;
  }

  rewireTopicLinks(fromTopicId: string, toTopicId: string): void {
    const next = new Set<string>();
    for (const key of this.topicLinks) {
      const [kind, subjectId, tid] = key.split(":");
      if (tid !== fromTopicId) {
        next.add(key);
        continue;
      }
      next.add(this.linkKey(kind as TopicLinkKind, subjectId, toTopicId));
    }
    this.topicLinks.clear();
    for (const key of next) this.topicLinks.add(key);
  }

  insertGitActivity(
    input: Omit<TeamAgentGitActivity, "id" | "created_at"> & { id?: string },
  ): TeamAgentGitActivity {
    const row: TeamAgentGitActivity = {
      ...input,
      id: input.id ?? randomUUID(),
      created_at: nowIso(),
    };
    this.gitActivity.set(row.id, row);
    return row;
  }
}
