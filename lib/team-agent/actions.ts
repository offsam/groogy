/**
 * Allowlisted agent actions — schema + domain validation before execution.
 * No Zod in this repo; lightweight validators mirror CHECK constraints.
 */

import { detectPathConflicts } from "./conflicts";
import { confirmDecision, proposeDecision, supersedeDecision } from "./decisions";
import type { TeamAgentStore } from "./store-port";
import { assignTask, proposeTask } from "./tasks";
import type {
  AgentActionProposal,
  AllowedAgentAction,
  ForbiddenAgentAction,
} from "./types";
import { ALLOWED_AGENT_ACTIONS, FORBIDDEN_AGENT_ACTIONS } from "./types";

export type ActionValidationResult =
  | { ok: true; action: AllowedAgentAction; payload: Record<string, unknown> }
  | { ok: false; error: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every((x) => typeof x === "string")) return null;
  return v.map((x) => x.trim()).filter(Boolean);
}

export function isForbiddenAction(type: string): type is ForbiddenAgentAction {
  return (FORBIDDEN_AGENT_ACTIONS as readonly string[]).includes(type);
}

export function isAllowedAction(type: string): type is AllowedAgentAction {
  return (ALLOWED_AGENT_ACTIONS as readonly string[]).includes(type);
}

export function validateAgentAction(
  proposal: AgentActionProposal,
): ActionValidationResult {
  const type = (proposal.type ?? "").trim();
  if (!type) return { ok: false, error: "action type required" };

  if (isForbiddenAction(type)) {
    return { ok: false, error: `forbidden action: ${type}` };
  }

  if (!isAllowedAction(type)) {
    return { ok: false, error: `unknown action: ${type}` };
  }

  if (!isObject(proposal.payload)) {
    return { ok: false, error: "payload must be an object" };
  }

  const p = proposal.payload;

  switch (type) {
    case "create_task": {
      if (!asString(p.title)) return { ok: false, error: "create_task.title required" };
      break;
    }
    case "update_task": {
      if (!asString(p.taskId)) return { ok: false, error: "update_task.taskId required" };
      break;
    }
    case "assign_task": {
      if (!asString(p.taskId) || !asString(p.memberId)) {
        return { ok: false, error: "assign_task requires taskId and memberId" };
      }
      break;
    }
    case "record_decision": {
      if (!asString(p.title)) {
        return { ok: false, error: "record_decision.title required" };
      }
      break;
    }
    case "supersede_decision": {
      if (!asString(p.oldDecisionId) || !asString(p.title)) {
        return {
          ok: false,
          error: "supersede_decision requires oldDecisionId and title",
        };
      }
      break;
    }
    case "record_memory": {
      if (!asString(p.subject) || !asString(p.content) || !asString(p.memory_type)) {
        return {
          ok: false,
          error: "record_memory requires memory_type, subject, content",
        };
      }
      break;
    }
    case "request_repository_context":
      break;
    case "check_conflicts": {
      const a = asStringArray(p.pathsA);
      const b = asStringArray(p.pathsB);
      if (!a || !b) {
        return { ok: false, error: "check_conflicts requires pathsA and pathsB arrays" };
      }
      break;
    }
    case "propose_assignment_batch": {
      if (!Array.isArray(p.assignments)) {
        return { ok: false, error: "propose_assignment_batch.assignments required" };
      }
      break;
    }
    default:
      return { ok: false, error: `unhandled action: ${type}` };
  }

  return { ok: true, action: type, payload: p };
}

/**
 * Execute validated actions. Mutating assignment/decision confirmations that
 * require human approval are staged as approvals instead of applied.
 */
export async function executeValidatedAction(
  store: TeamAgentStore,
  proposal: AgentActionProposal,
  opts?: { autoApplyAssignments?: boolean },
): Promise<{ applied: boolean; result: unknown; error?: string }> {
  const validated = validateAgentAction(proposal);
  if (!validated.ok) {
    return { applied: false, result: null, error: validated.error };
  }

  const { action, payload } = validated;

  switch (action) {
    case "create_task": {
      const task = await proposeTask(store, {
        title: String(payload.title),
        description: asString(payload.description) ?? "",
        scope_paths: asStringArray(payload.scope_paths) ?? [],
        acceptance_criteria: asStringArray(payload.acceptance_criteria) ?? [],
      });
      return { applied: true, result: task };
    }
    case "assign_task": {
      if (!opts?.autoApplyAssignments) {
        const approval = await store.insertApproval({
          approval_type: "task_assignment",
          status: "pending",
          payload: {
            taskId: payload.taskId,
            memberId: payload.memberId,
          },
          proposed_by_member_id: null,
          decided_by_member_id: null,
          source_message_id: null,
        });
        return { applied: false, result: approval };
      }
      const task = await assignTask(
        store,
        String(payload.taskId),
        String(payload.memberId),
      );
      return { applied: true, result: task };
    }
    case "record_decision": {
      const decision = await proposeDecision(store, {
        title: String(payload.title),
        description: asString(payload.description) ?? "",
      });
      return { applied: true, result: decision };
    }
    case "supersede_decision": {
      const result = await supersedeDecision(store, String(payload.oldDecisionId), {
        title: String(payload.title),
        description: asString(payload.description) ?? "",
        autoConfirm: Boolean(payload.autoConfirm),
      });
      return { applied: true, result };
    }
    case "record_memory": {
      const mem = await store.upsertMemory({
        memory_type: payload.memory_type as
          | "project_fact"
          | "team_fact"
          | "decision"
          | "constraint"
          | "preference"
          | "summary",
        subject: String(payload.subject),
        content: String(payload.content),
        source_message_id: asString(payload.source_message_id),
        confidence: "medium",
        status: "active",
      });
      return { applied: true, result: mem };
    }
    case "update_task": {
      const task = await store.getTask(String(payload.taskId));
      if (!task) return { applied: false, result: null, error: "task not found" };
      const next = await store.upsertTask({
        ...task,
        title: asString(payload.title) ?? task.title,
        description: asString(payload.description) ?? task.description,
        scope_paths: asStringArray(payload.scope_paths) ?? task.scope_paths,
      });
      return { applied: true, result: next };
    }
    case "check_conflicts": {
      const report = detectPathConflicts(
        asStringArray(payload.pathsA)!,
        asStringArray(payload.pathsB)!,
      );
      return { applied: true, result: report };
    }
    case "request_repository_context":
      return { applied: true, result: { deferred: true } };
    case "propose_assignment_batch": {
      const approval = await store.insertApproval({
        approval_type: "task_batch",
        status: "pending",
        payload: { assignments: payload.assignments },
        proposed_by_member_id: null,
        decided_by_member_id: null,
        source_message_id: null,
      });
      return { applied: false, result: approval };
    }
    default:
      return { applied: false, result: null, error: "unreachable" };
  }
}

export async function approvePendingAssignment(
  store: TeamAgentStore,
  approvalId: string,
  decidedByMemberId?: string | null,
): Promise<{ approval: unknown; tasks: unknown[] }> {
  const approval = await store.getApproval(approvalId);
  if (!approval) throw new Error(`approval not found: ${approvalId}`);
  if (approval.status !== "pending") {
    throw new Error(`approval not pending: ${approval.status}`);
  }

  const appliedTasks = [];
  if (approval.approval_type === "task_assignment") {
    const taskId = String(approval.payload.taskId);
    const memberId = String(approval.payload.memberId);
    appliedTasks.push(await assignTask(store, taskId, memberId));
  } else if (approval.approval_type === "task_batch") {
    const assignments = approval.payload.assignments as Array<{
      taskId: string;
      memberId: string;
    }>;
    for (const a of assignments ?? []) {
      appliedTasks.push(await assignTask(store, a.taskId, a.memberId));
    }
  } else if (approval.approval_type === "decision_confirm") {
    await confirmDecision(store, String(approval.payload.decisionId), decidedByMemberId);
  }

  const updated = await store.updateApproval(approvalId, {
    status: "approved",
    decided_by_member_id: decidedByMemberId ?? null,
    decided_at: new Date().toISOString(),
  });

  return { approval: updated, tasks: appliedTasks };
}
