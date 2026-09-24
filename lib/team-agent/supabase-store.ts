/**
 * Supabase-backed Team Agent store (server-only).
 * Used by the real Telegram webhook path — not by unit tests/simulator.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service";
import type { Database, Json } from "@/types/database";
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
  TeamAgentTaskPriority,
  TeamAgentTaskStatus,
  TeamAgentDecisionStatus,
  TeamAgentMemoryType,
  TeamAgentMemoryStatus,
  TeamAgentMessageType,
  TeamAgentApprovalType,
  TeamAgentApprovalStatus,
  TeamAgentGitEventType,
} from "./types";

type Db = SupabaseClient<Database>;

function asStringArray(value: Json | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapMember(
  row: Database["public"]["Tables"]["team_agent_members"]["Row"],
): TeamAgentMember {
  return {
    id: row.id,
    display_name: row.display_name,
    telegram_user_id: row.telegram_user_id,
    telegram_username: row.telegram_username,
    github_username: row.github_username,
    role_title: row.role_title,
    responsibilities: asStringArray(row.responsibilities),
    skills: asStringArray(row.skills),
    working_preferences: row.working_preferences,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapConversation(
  row: Database["public"]["Tables"]["team_agent_conversations"]["Row"],
): TeamAgentConversation {
  return {
    id: row.id,
    source_type: row.source_type,
    external_conversation_id: row.external_conversation_id,
    title: row.title,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapMessage(
  row: Database["public"]["Tables"]["team_agent_messages"]["Row"],
): TeamAgentMessage {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    member_id: row.member_id,
    external_message_id: row.external_message_id,
    reply_to_message_id: row.reply_to_message_id,
    message_type: row.message_type,
    body: row.body,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    occurred_at: row.occurred_at,
    created_at: row.created_at,
  };
}

function mapDecision(
  row: Database["public"]["Tables"]["team_agent_decisions"]["Row"],
): TeamAgentDecision {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    source_message_id: row.source_message_id,
    decided_by: row.decided_by,
    supersedes_decision_id: row.supersedes_decision_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapTask(
  row: Database["public"]["Tables"]["team_agent_tasks"]["Row"],
): TeamAgentTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as TeamAgentTaskStatus,
    priority: row.priority as TeamAgentTaskPriority,
    assigned_member_id: row.assigned_member_id,
    created_by_member_id: row.created_by_member_id,
    source_message_id: row.source_message_id,
    branch_name: row.branch_name,
    scope_paths: row.scope_paths ?? [],
    protected_paths: row.protected_paths ?? [],
    excluded_paths: row.excluded_paths ?? [],
    acceptance_criteria: asStringArray(row.acceptance_criteria),
    dependency_task_ids: row.dependency_task_ids ?? [],
    started_at: row.started_at,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapMemory(
  row: Database["public"]["Tables"]["team_agent_memory"]["Row"],
): TeamAgentMemory {
  return {
    id: row.id,
    memory_type: row.memory_type as TeamAgentMemoryType,
    subject: row.subject,
    content: row.content,
    source_message_id: row.source_message_id,
    confidence: row.confidence,
    status: row.status as TeamAgentMemoryStatus,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapApproval(
  row: Database["public"]["Tables"]["team_agent_approvals"]["Row"],
): TeamAgentApproval {
  return {
    id: row.id,
    approval_type: row.approval_type as TeamAgentApprovalType,
    status: row.status as TeamAgentApprovalStatus,
    payload:
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {},
    proposed_by_member_id: row.proposed_by_member_id,
    decided_by_member_id: row.decided_by_member_id,
    source_message_id: row.source_message_id,
    created_at: row.created_at,
    decided_at: row.decided_at,
  };
}

export class SupabaseTeamAgentStore implements TeamAgentStore {
  constructor(private readonly db: Db = createServiceRoleClient()) {}

  async upsertMember(
    input: Omit<TeamAgentMember, "id" | "created_at" | "updated_at"> & {
      id?: string;
    },
  ): Promise<TeamAgentMember> {
    const id = input.id ?? randomUUID();
    const { data, error } = await this.db
      .from("team_agent_members")
      .upsert(
        {
          id,
          display_name: input.display_name,
          telegram_user_id: input.telegram_user_id,
          telegram_username: input.telegram_username,
          github_username: input.github_username,
          role_title: input.role_title,
          responsibilities: input.responsibilities,
          skills: input.skills,
          working_preferences: input.working_preferences,
          is_active: input.is_active,
          updated_at: nowIso(),
        },
        { onConflict: "id" },
      )
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message ?? "upsertMember failed");
    return mapMember(data);
  }

  async findMemberByTelegramUserId(
    telegramUserId: number,
  ): Promise<TeamAgentMember | null> {
    const { data, error } = await this.db
      .from("team_agent_members")
      .select("*")
      .eq("telegram_user_id", telegramUserId)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapMember(data) : null;
  }

  async findMemberByTelegramUsername(
    username: string,
  ): Promise<TeamAgentMember | null> {
    const u = username.replace(/^@/, "");
    const { data, error } = await this.db
      .from("team_agent_members")
      .select("*")
      .ilike("telegram_username", u)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapMember(data) : null;
  }

  async listActiveMembers(): Promise<TeamAgentMember[]> {
    const { data, error } = await this.db
      .from("team_agent_members")
      .select("*")
      .eq("is_active", true);
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapMember);
  }

  async findOrCreateConversation(input: {
    source_type: TeamAgentSourceType;
    external_conversation_id: string | null;
    title?: string;
  }): Promise<TeamAgentConversation> {
    if (input.external_conversation_id) {
      const { data: existing, error } = await this.db
        .from("team_agent_conversations")
        .select("*")
        .eq("source_type", input.source_type)
        .eq("external_conversation_id", input.external_conversation_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (existing) return mapConversation(existing);
    }

    const { data, error } = await this.db
      .from("team_agent_conversations")
      .insert({
        source_type: input.source_type,
        external_conversation_id: input.external_conversation_id,
        title: input.title ?? "Team chat",
      })
      .select("*")
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? "findOrCreateConversation failed");
    }
    return mapConversation(data);
  }

  async findMessageByExternal(
    conversationId: string,
    externalMessageId: string,
  ): Promise<TeamAgentMessage | null> {
    const { data, error } = await this.db
      .from("team_agent_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .eq("external_message_id", externalMessageId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapMessage(data) : null;
  }

  async insertMessage(
    input: Omit<TeamAgentMessage, "id" | "created_at"> & { id?: string },
  ): Promise<TeamAgentMessage> {
    if (input.external_message_id) {
      const dup = await this.findMessageByExternal(
        input.conversation_id,
        input.external_message_id,
      );
      if (dup) return dup;
    }
    const { data, error } = await this.db
      .from("team_agent_messages")
      .insert({
        id: input.id ?? randomUUID(),
        conversation_id: input.conversation_id,
        member_id: input.member_id,
        external_message_id: input.external_message_id,
        reply_to_message_id: input.reply_to_message_id,
        message_type: input.message_type as TeamAgentMessageType,
        body: input.body,
        metadata: input.metadata as Json,
        occurred_at: input.occurred_at,
      })
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message ?? "insertMessage failed");
    return mapMessage(data);
  }

  async updateMessage(
    id: string,
    patch: Partial<
      Pick<TeamAgentMessage, "body" | "metadata" | "message_type" | "occurred_at">
    >,
  ): Promise<TeamAgentMessage> {
    const existing = await this.db
      .from("team_agent_messages")
      .select("*")
      .eq("id", id)
      .single();
    if (existing.error || !existing.data) {
      throw new Error(existing.error?.message ?? "message not found");
    }
    const prev = mapMessage(existing.data);
    const { data, error } = await this.db
      .from("team_agent_messages")
      .update({
        body: patch.body ?? prev.body,
        message_type: (patch.message_type ?? prev.message_type) as TeamAgentMessageType,
        occurred_at: patch.occurred_at ?? prev.occurred_at,
        metadata: (patch.metadata
          ? { ...prev.metadata, ...patch.metadata }
          : prev.metadata) as Json,
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message ?? "updateMessage failed");
    return mapMessage(data);
  }

  async listRecentMessages(
    conversationId: string,
    limit: number,
  ): Promise<TeamAgentMessage[]> {
    const { data, error } = await this.db
      .from("team_agent_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapMessage).reverse();
  }

  async getDecision(id: string): Promise<TeamAgentDecision | null> {
    const { data, error } = await this.db
      .from("team_agent_decisions")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapDecision(data) : null;
  }

  async upsertDecision(
    input: Omit<TeamAgentDecision, "id" | "created_at" | "updated_at"> & {
      id?: string;
    },
  ): Promise<TeamAgentDecision> {
    const id = input.id ?? randomUUID();
    const { data, error } = await this.db
      .from("team_agent_decisions")
      .upsert(
        {
          id,
          title: input.title,
          description: input.description,
          status: input.status as TeamAgentDecisionStatus,
          source_message_id: input.source_message_id,
          decided_by: input.decided_by,
          supersedes_decision_id: input.supersedes_decision_id,
          updated_at: nowIso(),
        },
        { onConflict: "id" },
      )
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message ?? "upsertDecision failed");
    return mapDecision(data);
  }

  async listDecisions(): Promise<TeamAgentDecision[]> {
    const { data, error } = await this.db.from("team_agent_decisions").select("*");
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapDecision);
  }

  async getTask(id: string): Promise<TeamAgentTask | null> {
    const { data, error } = await this.db
      .from("team_agent_tasks")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapTask(data) : null;
  }

  async upsertTask(
    input: Omit<TeamAgentTask, "id" | "created_at" | "updated_at"> & {
      id?: string;
    },
  ): Promise<TeamAgentTask> {
    const id = input.id ?? randomUUID();
    const { data, error } = await this.db
      .from("team_agent_tasks")
      .upsert(
        {
          id,
          title: input.title,
          description: input.description,
          status: input.status,
          priority: input.priority,
          assigned_member_id: input.assigned_member_id,
          created_by_member_id: input.created_by_member_id,
          source_message_id: input.source_message_id,
          branch_name: input.branch_name,
          scope_paths: input.scope_paths,
          protected_paths: input.protected_paths,
          excluded_paths: input.excluded_paths,
          acceptance_criteria: input.acceptance_criteria,
          dependency_task_ids: input.dependency_task_ids,
          started_at: input.started_at,
          completed_at: input.completed_at,
          updated_at: nowIso(),
        },
        { onConflict: "id" },
      )
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message ?? "upsertTask failed");
    return mapTask(data);
  }

  async listTasks(): Promise<TeamAgentTask[]> {
    const { data, error } = await this.db.from("team_agent_tasks").select("*");
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapTask);
  }

  async upsertMemory(
    input: Omit<TeamAgentMemory, "id" | "created_at" | "updated_at"> & {
      id?: string;
    },
  ): Promise<TeamAgentMemory> {
    const id = input.id ?? randomUUID();
    const { data, error } = await this.db
      .from("team_agent_memory")
      .upsert(
        {
          id,
          memory_type: input.memory_type,
          subject: input.subject,
          content: input.content,
          source_message_id: input.source_message_id,
          confidence: input.confidence,
          status: input.status,
          updated_at: nowIso(),
        },
        { onConflict: "id" },
      )
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message ?? "upsertMemory failed");
    return mapMemory(data);
  }

  async listMemory(): Promise<TeamAgentMemory[]> {
    const { data, error } = await this.db.from("team_agent_memory").select("*");
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapMemory);
  }

  async getApproval(id: string): Promise<TeamAgentApproval | null> {
    const { data, error } = await this.db
      .from("team_agent_approvals")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? mapApproval(data) : null;
  }

  async insertApproval(
    input: Omit<TeamAgentApproval, "id" | "created_at" | "decided_at"> & {
      id?: string;
      decided_at?: string | null;
    },
  ): Promise<TeamAgentApproval> {
    const { data, error } = await this.db
      .from("team_agent_approvals")
      .insert({
        id: input.id ?? randomUUID(),
        approval_type: input.approval_type,
        status: input.status,
        payload: input.payload as Json,
        proposed_by_member_id: input.proposed_by_member_id,
        decided_by_member_id: input.decided_by_member_id,
        source_message_id: input.source_message_id,
        decided_at: input.decided_at ?? null,
      })
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message ?? "insertApproval failed");
    return mapApproval(data);
  }

  async updateApproval(
    id: string,
    patch: Partial<TeamAgentApproval>,
  ): Promise<TeamAgentApproval> {
    const { data, error } = await this.db
      .from("team_agent_approvals")
      .update({
        status: patch.status,
        payload: patch.payload as Json | undefined,
        decided_by_member_id: patch.decided_by_member_id,
        decided_at: patch.decided_at,
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message ?? "updateApproval failed");
    return mapApproval(data);
  }

  async listApprovals(): Promise<TeamAgentApproval[]> {
    const { data, error } = await this.db.from("team_agent_approvals").select("*");
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapApproval);
  }

  async insertGitActivity(
    input: Omit<TeamAgentGitActivity, "id" | "created_at"> & { id?: string },
  ): Promise<TeamAgentGitActivity> {
    const { data, error } = await this.db
      .from("team_agent_git_activity")
      .insert({
        id: input.id ?? randomUUID(),
        task_id: input.task_id,
        member_id: input.member_id,
        repository: input.repository,
        branch_name: input.branch_name,
        commit_sha: input.commit_sha,
        commit_message: input.commit_message,
        event_type: input.event_type as TeamAgentGitEventType,
        metadata: input.metadata as Json,
      })
      .select("*")
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? "insertGitActivity failed");
    }
    return {
      id: data.id,
      task_id: data.task_id,
      member_id: data.member_id,
      repository: data.repository,
      branch_name: data.branch_name,
      commit_sha: data.commit_sha,
      commit_message: data.commit_message,
      event_type: data.event_type,
      metadata:
        data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
          ? (data.metadata as Record<string, unknown>)
          : {},
      created_at: data.created_at,
    };
  }
}
