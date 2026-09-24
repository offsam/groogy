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
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

export type TeamAgentStoreSnapshot = {
  members: TeamAgentMember[];
  conversations: TeamAgentConversation[];
  messages: TeamAgentMessage[];
  decisions: TeamAgentDecision[];
  tasks: TeamAgentTask[];
  gitActivity: TeamAgentGitActivity[];
  memory: TeamAgentMemory[];
  approvals: TeamAgentApproval[];
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

  clear(): void {
    this.members.clear();
    this.conversations.clear();
    this.messages.clear();
    this.decisions.clear();
    this.tasks.clear();
    this.gitActivity.clear();
    this.memory.clear();
    this.approvals.clear();
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
