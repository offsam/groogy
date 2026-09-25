/**
 * TeamAgentProvider abstraction — Mock only in V1 (no production LLM).
 */

import { recommendTaskDistribution } from "./distribution";
import type { TeamAgentStore } from "./store-port";
import type {
  AgentRespondRequest,
  AgentRespondResult,
  TeamAgentContext,
} from "./types";

export interface TeamAgentProvider {
  respond(
    context: TeamAgentContext,
    request: AgentRespondRequest,
    store?: TeamAgentStore,
  ): Promise<AgentRespondResult> | AgentRespondResult;
}

export class MockTeamAgentProvider implements TeamAgentProvider {
  async respond(
    context: TeamAgentContext,
    request: AgentRespondRequest,
    store?: TeamAgentStore,
  ): Promise<AgentRespondResult> {
    const lines: string[] = [];
    lines.push("Team Agent (mock): я на связи.");

    if (context.requestingMember) {
      lines.push(`Запрос от: ${context.requestingMember.display_name}.`);
    } else {
      lines.push("Запрос от неизвестного участника (не в team_agent_members).");
    }

    lines.push(
      `Участников: ${context.members.length}; активных задач: ${context.activeTasks.length}; подтверждённых решений: ${context.activeDecisions.length}.`,
    );

    if (context.potentialConflicts.length > 0) {
      lines.push(
        `Потенциальные file conflicts: ${context.potentialConflicts.length}.`,
      );
    }

    const proposedActions: AgentRespondResult["proposedActions"] = [];
    let needsHumanApproval = false;

    const text = request.userText.toLowerCase();
    if (
      text.includes("распредел") ||
      text.includes("assign") ||
      text.includes("задач")
    ) {
      if (store) {
        const recs = await recommendTaskDistribution(store);
        if (recs.length > 0) {
          lines.push("Предлагаю распределение (нужно подтверждение):");
          const assignments: Array<{ taskId: string; memberId: string }> = [];
          for (const r of recs) {
            const task = context.activeTasks.find((t) => t.id === r.taskId);
            const member = context.members.find(
              (m) => m.id === r.recommendedMemberId,
            );
            const title = task?.title ?? r.taskId;
            const name = member?.display_name ?? "unassigned";
            lines.push(`• ${name} → ${title}`);
            if (r.overlaps.length) {
              lines.push(
                `  conflict: ${r.overlaps.map((o) => `${o.pathA}∩${o.pathB} (${o.severity})`).join("; ")}`,
              );
            }
            if (r.recommendedMemberId) {
              assignments.push({
                taskId: r.taskId,
                memberId: r.recommendedMemberId,
              });
            }
          }
          if (assignments.length) {
            proposedActions.push({
              type: "propose_assignment_batch",
              payload: { assignments },
            });
            needsHumanApproval = true;
            lines.push("Подтвердить распределение?");
          }
        } else {
          lines.push("Нет задач для распределения (proposed/unassigned).");
        }
      }
    }

    if (text.includes("аудит") || text.includes("вывод")) {
      lines.push("Краткий аудит контекста:");
      lines.push(
        `• последних сообщений в контексте: ${context.recentMessages.length}`,
      );
      lines.push(
        `• блокеров: ${context.blockedTasks.length}; memory: ${context.relevantMemory.length}`,
      );
      lines.push(
        `• repo: ${context.repository.provider} / branch ${context.repository.currentBranch ?? "?"}`,
      );
    }

    return {
      replyText: lines.join("\n"),
      proposedActions,
      needsHumanApproval,
      provider: "mock",
      model: null,
      responseId: null,
      usage: null,
    };
  }
}
