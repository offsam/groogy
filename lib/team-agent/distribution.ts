/**
 * Deterministic task distribution recommendations (no LLM ownership).
 */

import { detectPathConflicts } from "./conflicts";
import type { TeamAgentStore } from "./store-port";
import { isActiveTaskStatus, listActiveWorkload } from "./tasks";
import type {
  DistributionRecommendation,
  PathConflict,
  TeamAgentMember,
  TeamAgentTask,
} from "./types";

function scoreMemberForTask(
  member: TeamAgentMember,
  task: TeamAgentTask,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const hay = [
    ...member.responsibilities,
    ...member.skills,
    member.role_title ?? "",
  ]
    .join(" ")
    .toLowerCase();

  for (const path of task.scope_paths) {
    const token = path.split("/").filter(Boolean)[0]?.toLowerCase();
    if (token && hay.includes(token)) {
      score += 3;
      reasons.push(`scope token «${token}» matches profile`);
    }
  }

  for (const skill of member.skills) {
    const s = skill.toLowerCase();
    if (
      task.title.toLowerCase().includes(s) ||
      task.description.toLowerCase().includes(s)
    ) {
      score += 2;
      reasons.push(`skill «${skill}» matches task text`);
    }
  }

  for (const resp of member.responsibilities) {
    const r = resp.toLowerCase();
    if (
      task.scope_paths.some((p) => p.toLowerCase().includes(r)) ||
      task.title.toLowerCase().includes(r)
    ) {
      score += 4;
      reasons.push(`responsibility «${resp}» matches`);
    }
  }

  return { score, reasons };
}

export async function recommendTaskDistribution(
  store: TeamAgentStore,
  opts?: { taskIds?: string[] },
): Promise<DistributionRecommendation[]> {
  const members = await store.listActiveMembers();
  const allTasks = await store.listTasks();
  const tasks = allTasks.filter((t) => {
    if (opts?.taskIds && !opts.taskIds.includes(t.id)) return false;
    return (
      t.status === "proposed" ||
      t.status === "approved" ||
      !t.assigned_member_id
    );
  });

  const active = allTasks.filter((t) => isActiveTaskStatus(t.status));
  const out: DistributionRecommendation[] = [];

  for (const task of tasks) {
    const overlaps: PathConflict[] = [];
    for (const other of active) {
      if (other.id === task.id) continue;
      const report = detectPathConflicts(task.scope_paths, other.scope_paths);
      overlaps.push(...report.overlaps);
    }

    const dependencyWarnings: string[] = [];
    for (const depId of task.dependency_task_ids) {
      const dep = await store.getTask(depId);
      if (!dep) {
        dependencyWarnings.push(`missing dependency ${depId}`);
        continue;
      }
      if (dep.status !== "completed") {
        dependencyWarnings.push(
          `dependency «${dep.title}» is ${dep.status}, not completed`,
        );
      }
    }

    let best: TeamAgentMember | null = null;
    let bestScore = -1;
    let bestReasons: string[] = [];

    for (const member of members) {
      const { score, reasons } = scoreMemberForTask(member, task);
      const workload = (await listActiveWorkload(store, member.id)).length;
      const adjusted = score - workload;
      if (adjusted > bestScore) {
        bestScore = adjusted;
        best = member;
        bestReasons = [
          ...reasons,
          ...(workload > 0 ? [`current active load: ${workload}`] : []),
        ];
      }
    }

    let workloadWarning: string | null = null;
    if (best) {
      const load = (await listActiveWorkload(store, best.id)).length;
      if (load >= 3) {
        workloadWarning = `${best.display_name} already has ${load} active tasks`;
      }
    }

    if (bestReasons.length === 0 && best) {
      bestReasons.push("fallback: least loaded active member");
    }

    out.push({
      taskId: task.id,
      recommendedMemberId: best?.id ?? null,
      reasons: bestReasons,
      overlaps,
      dependencyWarnings,
      workloadWarning,
    });
  }

  return out;
}
