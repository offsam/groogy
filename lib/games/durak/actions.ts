"use server";

import type { DurakMode, DurakView } from "@/lib/games/durak/engine";
import {
  loadDurakView,
  mutateDurak,
  parseDurakTableId,
  type DurakTableId,
} from "@/lib/games/durak/store";
import { issueDurakVoiceToken, type DurakVoiceTicket } from "@/lib/games/durak/voice";

export type DurakActionResult = {
  view: DurakView;
  message: string | null;
};

function tableIdOf(value: number): DurakTableId {
  const id = parseDurakTableId(value);
  if (!id) throw new Error("Нет такого стола.");
  return id;
}

export async function refreshDurakAction(table: number): Promise<DurakView> {
  return loadDurakView(tableIdOf(table));
}

export async function sitDurakAction(
  table: number,
  seat: number,
): Promise<DurakActionResult> {
  const tableId = tableIdOf(table);
  const view = await loadDurakView(tableId);
  if (!view.you) {
    return { view, message: "Чтобы сесть, войдите или зарегистрируйтесь." };
  }
  return mutateDurak(tableId, {
    type: "sit",
    seat,
    userId: view.you.id,
    name: view.you.name,
  });
}

export async function leaveDurakAction(table: number): Promise<DurakActionResult> {
  const tableId = tableIdOf(table);
  const view = await loadDurakView(tableId);
  if (!view.you) return { view, message: null };
  return mutateDurak(tableId, { type: "leave", userId: view.you.id });
}

export async function redealDurakAction(table: number): Promise<DurakActionResult> {
  const tableId = tableIdOf(table);
  const view = await loadDurakView(tableId);
  if (!view.you) return { view, message: "Нужно войти." };
  return mutateDurak(tableId, { type: "redeal", userId: view.you.id });
}

export async function playDurakCardAction(
  table: number,
  cardId: string,
): Promise<DurakActionResult> {
  const tableId = tableIdOf(table);
  const view = await loadDurakView(tableId);
  if (!view.you) return { view, message: "Нужно войти." };
  return mutateDurak(tableId, { type: "play", userId: view.you.id, cardId });
}

export async function takeDurakAction(table: number): Promise<DurakActionResult> {
  const tableId = tableIdOf(table);
  const view = await loadDurakView(tableId);
  if (!view.you) return { view, message: "Нужно войти." };
  return mutateDurak(tableId, { type: "take", userId: view.you.id });
}

export async function passDurakAction(table: number): Promise<DurakActionResult> {
  const tableId = tableIdOf(table);
  const view = await loadDurakView(tableId);
  if (!view.you) return { view, message: "Нужно войти." };
  return mutateDurak(tableId, { type: "pass", userId: view.you.id });
}

export async function voteDurakModeAction(
  table: number,
  mode: DurakMode,
): Promise<DurakActionResult> {
  const tableId = tableIdOf(table);
  const view = await loadDurakView(tableId);
  if (!view.you) return { view, message: "Нужно войти." };
  return mutateDurak(tableId, { type: "vote-mode", userId: view.you.id, mode });
}

export async function voteDurakBotAction(
  table: number,
  choice: "keep" | "drop",
): Promise<DurakActionResult> {
  const tableId = tableIdOf(table);
  const view = await loadDurakView(tableId);
  if (!view.you) return { view, message: "Нужно войти." };
  return mutateDurak(tableId, { type: "vote-bot", userId: view.you.id, choice });
}

export async function durakVoiceTokenAction(
  table: number,
  guestId: string,
): Promise<DurakVoiceTicket> {
  return issueDurakVoiceToken(tableIdOf(table), guestId);
}
