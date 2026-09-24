/**
 * Controlled memory helpers — CHAT HISTORY != MEMORY.
 */

import type { TeamAgentStore } from "./store-port";
import type { TeamAgentMemory, TeamAgentMemoryType } from "./types";

export async function recordMemory(
  store: TeamAgentStore,
  input: {
    memory_type: TeamAgentMemoryType;
    subject: string;
    content: string;
    source_message_id?: string | null;
    confidence?: TeamAgentMemory["confidence"];
  },
): Promise<TeamAgentMemory> {
  return store.upsertMemory({
    memory_type: input.memory_type,
    subject: input.subject.trim(),
    content: input.content.trim(),
    source_message_id: input.source_message_id ?? null,
    confidence: input.confidence ?? "medium",
    status: "active",
  });
}

export async function invalidateMemory(
  store: TeamAgentStore,
  memoryId: string,
): Promise<TeamAgentMemory> {
  const all = await store.listMemory();
  const m = all.find((x) => x.id === memoryId);
  if (!m) throw new Error(`memory not found: ${memoryId}`);
  return store.upsertMemory({ ...m, status: "invalid" });
}

export async function supersedeMemory(
  store: TeamAgentStore,
  oldId: string,
  next: {
    memory_type: TeamAgentMemoryType;
    subject: string;
    content: string;
    source_message_id?: string | null;
  },
): Promise<{ old: TeamAgentMemory; next: TeamAgentMemory }> {
  const old = await invalidateMemory(store, oldId);
  await store.upsertMemory({ ...old, status: "superseded" });
  const created = await recordMemory(store, next);
  const refreshed = (await store.listMemory()).find((x) => x.id === oldId)!;
  return { old: refreshed, next: created };
}

export async function listActiveMemory(
  store: TeamAgentStore,
): Promise<TeamAgentMemory[]> {
  return (await store.listMemory()).filter((m) => m.status === "active");
}
