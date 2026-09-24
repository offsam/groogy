/**
 * Decision lifecycle: proposed → confirmed | rejected; supersede without delete.
 */

import type { TeamAgentStore } from "./store-port";
import type { PotentialDecision, TeamAgentDecision } from "./types";
import { AUTHORITATIVE_DECISION_STATUSES } from "./types";

export async function proposeDecision(
  store: TeamAgentStore,
  input: {
    title: string;
    description?: string;
    source_message_id?: string | null;
    decided_by?: string | null;
    supersedes_decision_id?: string | null;
  },
): Promise<TeamAgentDecision> {
  if (!input.title.trim()) throw new Error("decision title required");
  return store.upsertDecision({
    title: input.title.trim(),
    description: input.description?.trim() ?? "",
    status: "proposed",
    source_message_id: input.source_message_id ?? null,
    decided_by: input.decided_by ?? null,
    supersedes_decision_id: input.supersedes_decision_id ?? null,
  });
}

export async function confirmDecision(
  store: TeamAgentStore,
  decisionId: string,
  decidedBy?: string | null,
): Promise<TeamAgentDecision> {
  const d = await store.getDecision(decisionId);
  if (!d) throw new Error(`decision not found: ${decisionId}`);
  if (d.status === "rejected" || d.status === "cancelled") {
    throw new Error(`cannot confirm decision in status ${d.status}`);
  }
  if (d.status === "superseded") {
    throw new Error("cannot confirm superseded decision");
  }

  if (d.supersedes_decision_id) {
    const old = await store.getDecision(d.supersedes_decision_id);
    if (old && (old.status === "confirmed" || old.status === "proposed")) {
      await store.upsertDecision({ ...old, status: "superseded" });
    }
  }

  return store.upsertDecision({
    ...d,
    status: "confirmed",
    decided_by: decidedBy ?? d.decided_by,
  });
}

export async function rejectDecision(
  store: TeamAgentStore,
  decisionId: string,
): Promise<TeamAgentDecision> {
  const d = await store.getDecision(decisionId);
  if (!d) throw new Error(`decision not found: ${decisionId}`);
  if (d.status === "confirmed") {
    throw new Error("reject confirmed via supersede, not reject");
  }
  return store.upsertDecision({ ...d, status: "rejected" });
}

export async function supersedeDecision(
  store: TeamAgentStore,
  oldDecisionId: string,
  replacement: {
    title: string;
    description?: string;
    source_message_id?: string | null;
    decided_by?: string | null;
    autoConfirm?: boolean;
  },
): Promise<{ old: TeamAgentDecision; next: TeamAgentDecision }> {
  const old = await store.getDecision(oldDecisionId);
  if (!old) throw new Error(`decision not found: ${oldDecisionId}`);

  const next = await store.upsertDecision({
    title: replacement.title.trim(),
    description: replacement.description?.trim() ?? "",
    status: replacement.autoConfirm ? "confirmed" : "proposed",
    source_message_id: replacement.source_message_id ?? null,
    decided_by: replacement.decided_by ?? null,
    supersedes_decision_id: oldDecisionId,
  });

  if (replacement.autoConfirm) {
    await store.upsertDecision({ ...old, status: "superseded" });
  }

  return { old: (await store.getDecision(oldDecisionId))!, next };
}

export async function listAuthoritativeDecisions(
  store: TeamAgentStore,
): Promise<TeamAgentDecision[]> {
  const all = await store.listDecisions();
  return all.filter((d) =>
    (AUTHORITATIVE_DECISION_STATUSES as readonly string[]).includes(d.status),
  );
}

/** LLM-proposed extraction stays proposed until human confirms. */
export async function recordPotentialDecision(
  store: TeamAgentStore,
  potential: PotentialDecision,
): Promise<TeamAgentDecision> {
  return proposeDecision(store, {
    title: potential.title,
    description: potential.description,
    source_message_id: potential.sourceMessageIds[0] ?? null,
  });
}
