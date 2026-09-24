/**
 * Task lifecycle transitions — validated, no LLM.
 */

import type { TeamAgentStore } from "./store-port";
import type {
  TeamAgentTask,
  TeamAgentTaskPriority,
  TeamAgentTaskStatus,
} from "./types";
import { ACTIVE_TASK_STATUSES } from "./types";
import { normalizeScopePath } from "./conflicts";

const ALLOWED_TRANSITIONS: Record<
  TeamAgentTaskStatus,
  readonly TeamAgentTaskStatus[]
> = {
  proposed: ["approved", "cancelled"],
  approved: ["in_progress", "cancelled", "blocked"],
  in_progress: ["blocked", "review", "completed", "cancelled"],
  blocked: ["in_progress", "cancelled"],
  review: ["in_progress", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransitionTask(
  from: TeamAgentTaskStatus,
  to: TeamAgentTaskStatus,
): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTaskTransition(
  from: TeamAgentTaskStatus,
  to: TeamAgentTaskStatus,
): void {
  if (!canTransitionTask(from, to)) {
    throw new Error(`invalid task transition: ${from} → ${to}`);
  }
}

export function isActiveTaskStatus(status: TeamAgentTaskStatus): boolean {
  return (ACTIVE_TASK_STATUSES as readonly string[]).includes(status);
}

function normalizePaths(paths: string[] | undefined): string[] {
  return (paths ?? []).map(normalizeScopePath).filter(Boolean);
}

export type ProposeTaskInput = {
  title: string;
  description?: string;
  priority?: TeamAgentTaskPriority;
  created_by_member_id?: string | null;
  source_message_id?: string | null;
  scope_paths?: string[];
  protected_paths?: string[];
  excluded_paths?: string[];
  acceptance_criteria?: string[];
  dependency_task_ids?: string[];
  assigned_member_id?: string | null;
  branch_name?: string | null;
};

export async function proposeTask(
  store: TeamAgentStore,
  input: ProposeTaskInput,
): Promise<TeamAgentTask> {
  if (!input.title.trim()) throw new Error("task title required");
  return store.upsertTask({
    title: input.title.trim(),
    description: input.description?.trim() ?? "",
    status: "proposed",
    priority: input.priority ?? "normal",
    assigned_member_id: input.assigned_member_id ?? null,
    created_by_member_id: input.created_by_member_id ?? null,
    source_message_id: input.source_message_id ?? null,
    branch_name: input.branch_name ?? null,
    scope_paths: normalizePaths(input.scope_paths),
    protected_paths: normalizePaths(input.protected_paths),
    excluded_paths: normalizePaths(input.excluded_paths),
    acceptance_criteria: input.acceptance_criteria ?? [],
    dependency_task_ids: input.dependency_task_ids ?? [],
    started_at: null,
    completed_at: null,
  });
}

export async function approveTask(
  store: TeamAgentStore,
  taskId: string,
): Promise<TeamAgentTask> {
  return transition(store, taskId, "approved");
}

export async function assignTask(
  store: TeamAgentStore,
  taskId: string,
  memberId: string,
  opts?: { requireApproved?: boolean },
): Promise<TeamAgentTask> {
  const task = await store.getTask(taskId);
  if (!task) throw new Error(`task not found: ${taskId}`);
  if (opts?.requireApproved && task.status === "proposed") {
    throw new Error("cannot assign proposed task without approval");
  }
  return store.upsertTask({
    ...task,
    assigned_member_id: memberId,
  });
}

export async function startTask(
  store: TeamAgentStore,
  taskId: string,
): Promise<TeamAgentTask> {
  const task = await transition(store, taskId, "in_progress");
  return store.upsertTask({
    ...task,
    started_at: task.started_at ?? new Date().toISOString(),
  });
}

export async function blockTask(
  store: TeamAgentStore,
  taskId: string,
): Promise<TeamAgentTask> {
  return transition(store, taskId, "blocked");
}

export async function markTaskForReview(
  store: TeamAgentStore,
  taskId: string,
): Promise<TeamAgentTask> {
  return transition(store, taskId, "review");
}

export async function completeTask(
  store: TeamAgentStore,
  taskId: string,
): Promise<TeamAgentTask> {
  const task = await transition(store, taskId, "completed");
  return store.upsertTask({
    ...task,
    completed_at: new Date().toISOString(),
  });
}

export async function cancelTask(
  store: TeamAgentStore,
  taskId: string,
): Promise<TeamAgentTask> {
  return transition(store, taskId, "cancelled");
}

async function transition(
  store: TeamAgentStore,
  taskId: string,
  to: TeamAgentTaskStatus,
): Promise<TeamAgentTask> {
  const task = await store.getTask(taskId);
  if (!task) throw new Error(`task not found: ${taskId}`);
  assertTaskTransition(task.status, to);
  return store.upsertTask({ ...task, status: to });
}

export async function listActiveWorkload(
  store: TeamAgentStore,
  memberId?: string,
): Promise<TeamAgentTask[]> {
  const tasks = await store.listTasks();
  return tasks.filter((t) => {
    if (!isActiveTaskStatus(t.status)) return false;
    if (memberId && t.assigned_member_id !== memberId) return false;
    return true;
  });
}
