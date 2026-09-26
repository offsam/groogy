/**
 * One pinned project-status message per chat or forum thread.
 * The Telegram message id lives on the system row, never in source code.
 */

import type { TeamAgentStore } from "./store-port";
import {
  PROJECT_STATUS_EXTERNAL_ID,
  connectionFacts,
  formatPinnedProjectStatus,
  type BriefConnections,
} from "./project-brief";

export type StatusPlacement = {
  telegram_message_id: number;
  pinned: boolean;
};

export type PinTransport = {
  send: (text: string) => Promise<{ ok: true; messageId: number } | { ok: false; error: string }>;
  edit: (messageId: number, text: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  pin: (messageId: number) => Promise<{ ok: true } | { ok: false; error: string }>;
  canPin: () => Promise<boolean>;
};

export type RefreshStatusResult = {
  text: string;
  action: "created" | "edited" | "failed";
  pinned: boolean;
  note: string | null;
};

const MISSING = /message to edit not found|message_id_invalid|message can't be edited|message to be edited not found/i;

export function placementKey(threadId: number | null): string {
  return threadId == null ? "chat" : `thread:${threadId}`;
}

export function readPlacements(metadata: Record<string, unknown>): Record<string, StatusPlacement> {
  const raw = metadata.placements;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, StatusPlacement> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as { telegram_message_id?: unknown; pinned?: unknown };
    const id = Number(row.telegram_message_id);
    if (!Number.isInteger(id)) continue;
    out[key] = { telegram_message_id: id, pinned: row.pinned === true };
  }
  return out;
}

export async function refreshPinnedProjectStatus(input: {
  store: TeamAgentStore;
  conversationId: string;
  threadId?: number | null;
  connections?: BriefConnections;
  env?: NodeJS.ProcessEnv;
  transport: PinTransport;
  now?: Date;
}): Promise<RefreshStatusResult> {
  const [tasks, members] = await Promise.all([
    input.store.listTasks(),
    input.store.listActiveMembers(),
  ]);
  const connections = input.connections ?? connectionFacts(input.env ?? process.env);
  const text = formatPinnedProjectStatus({ tasks, members, connections, now: input.now });
  const key = placementKey(input.threadId ?? null);
  const existing = await input.store.findMessageByExternal(
    input.conversationId,
    PROJECT_STATUS_EXTERNAL_ID,
  );
  const placements = readPlacements(existing?.metadata ?? {});
  const current = placements[key] ?? null;
  const canPin = await input.transport.canPin();

  const save = async (placement: StatusPlacement) => {
    const next = { ...placements, [key]: placement };
    const metadata = { kind: "project_status", placements: next };
    if (existing) {
      await input.store.updateMessage(existing.id, { body: text, metadata });
      return;
    }
    await input.store.insertMessage({
      conversation_id: input.conversationId,
      member_id: null,
      external_message_id: PROJECT_STATUS_EXTERNAL_ID,
      reply_to_message_id: null,
      message_type: "system",
      body: text,
      occurred_at: (input.now ?? new Date()).toISOString(),
      metadata,
    });
  };

  const publish = async (): Promise<RefreshStatusResult> => {
    const sent = await input.transport.send(text);
    if (!sent.ok) {
      return { text, action: "failed", pinned: false, note: `Не обновил статус: ${sent.error}` };
    }
    let pinned = false;
    let note: string | null = null;
    if (canPin) {
      const pin = await input.transport.pin(sent.messageId);
      pinned = pin.ok;
      if (!pin.ok) note = `Сообщение статуса есть, закрепить не удалось: ${pin.error}`;
    } else {
      note = "Сообщение статуса есть. Закрепить не удалось: у бота нет права pin.";
    }
    await save({ telegram_message_id: sent.messageId, pinned });
    return { text, action: "created", pinned, note };
  };

  if (!current) return publish();

  const edited = await input.transport.edit(current.telegram_message_id, text);
  if (!edited.ok && MISSING.test(edited.error)) return publish();
  if (!edited.ok) {
    return { text, action: "failed", pinned: current.pinned, note: `Не обновил статус: ${edited.error}` };
  }
  await save(current);
  return { text, action: "edited", pinned: current.pinned, note: null };
}
