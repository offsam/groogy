/**
 * Store port for Team Agent persistence.
 * InMemory (tests/simulator) and Supabase (Telegram production path).
 */

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

export type MaybePromise<T> = T | Promise<T>;

export type TeamAgentStore = {
  upsertMember(
    input: Omit<TeamAgentMember, "id" | "created_at" | "updated_at"> & {
      id?: string;
    },
  ): MaybePromise<TeamAgentMember>;
  findMemberByTelegramUserId(
    telegramUserId: number,
  ): MaybePromise<TeamAgentMember | null>;
  findMemberByTelegramUsername(
    username: string,
  ): MaybePromise<TeamAgentMember | null>;
  listActiveMembers(): MaybePromise<TeamAgentMember[]>;
  findOrCreateConversation(input: {
    source_type: TeamAgentSourceType;
    external_conversation_id: string | null;
    title?: string;
  }): MaybePromise<TeamAgentConversation>;
  findMessageByExternal(
    conversationId: string,
    externalMessageId: string,
  ): MaybePromise<TeamAgentMessage | null>;
  insertMessage(
    input: Omit<TeamAgentMessage, "id" | "created_at"> & { id?: string },
  ): MaybePromise<TeamAgentMessage>;
  updateMessage(
    id: string,
    patch: Partial<
      Pick<TeamAgentMessage, "body" | "metadata" | "message_type" | "occurred_at">
    >,
  ): MaybePromise<TeamAgentMessage>;
  listRecentMessages(
    conversationId: string,
    limit: number,
  ): MaybePromise<TeamAgentMessage[]>;
  getDecision(id: string): MaybePromise<TeamAgentDecision | null>;
  upsertDecision(
    input: Omit<TeamAgentDecision, "id" | "created_at" | "updated_at"> & {
      id?: string;
    },
  ): MaybePromise<TeamAgentDecision>;
  listDecisions(): MaybePromise<TeamAgentDecision[]>;
  getTask(id: string): MaybePromise<TeamAgentTask | null>;
  upsertTask(
    input: Omit<TeamAgentTask, "id" | "created_at" | "updated_at"> & {
      id?: string;
    },
  ): MaybePromise<TeamAgentTask>;
  listTasks(): MaybePromise<TeamAgentTask[]>;
  upsertMemory(
    input: Omit<TeamAgentMemory, "id" | "created_at" | "updated_at"> & {
      id?: string;
    },
  ): MaybePromise<TeamAgentMemory>;
  listMemory(): MaybePromise<TeamAgentMemory[]>;
  getApproval(id: string): MaybePromise<TeamAgentApproval | null>;
  insertApproval(
    input: Omit<TeamAgentApproval, "id" | "created_at" | "decided_at"> & {
      id?: string;
      decided_at?: string | null;
    },
  ): MaybePromise<TeamAgentApproval>;
  updateApproval(
    id: string,
    patch: Partial<TeamAgentApproval>,
  ): MaybePromise<TeamAgentApproval>;
  listApprovals(): MaybePromise<TeamAgentApproval[]>;
  insertGitActivity(
    input: Omit<TeamAgentGitActivity, "id" | "created_at"> & { id?: string },
  ): MaybePromise<TeamAgentGitActivity>;
};
