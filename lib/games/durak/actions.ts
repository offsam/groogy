"use server";

import {
  loadDurakView,
  mutateDurak,
} from "@/lib/games/durak/store";
import { issueDurakVoiceToken, type DurakVoiceTicket } from "@/lib/games/durak/voice";
import type { DurakMode, DurakView } from "@/lib/games/durak/engine";

export type DurakActionResult = {
  view: DurakView;
  message: string | null;
};

export async function refreshDurakAction(): Promise<DurakView> {
  return loadDurakView();
}

export async function sitDurakAction(seat: number): Promise<DurakActionResult> {
  const view = await loadDurakView();
  if (!view.you) {
    return { view, message: "Чтобы сесть, войдите или зарегистрируйтесь." };
  }
  return mutateDurak({
    type: "sit",
    seat,
    userId: view.you.id,
    name: view.you.name,
  });
}

export async function leaveDurakAction(): Promise<DurakActionResult> {
  const view = await loadDurakView();
  if (!view.you) return { view, message: null };
  return mutateDurak({ type: "leave", userId: view.you.id });
}

export async function redealDurakAction(): Promise<DurakActionResult> {
  const view = await loadDurakView();
  if (!view.you) return { view, message: "Нужно войти." };
  return mutateDurak({ type: "redeal", userId: view.you.id });
}

export async function playDurakCardAction(
  cardId: string,
): Promise<DurakActionResult> {
  const view = await loadDurakView();
  if (!view.you) return { view, message: "Нужно войти." };
  return mutateDurak({ type: "play", userId: view.you.id, cardId });
}

export async function takeDurakAction(): Promise<DurakActionResult> {
  const view = await loadDurakView();
  if (!view.you) return { view, message: "Нужно войти." };
  return mutateDurak({ type: "take", userId: view.you.id });
}

export async function passDurakAction(): Promise<DurakActionResult> {
  const view = await loadDurakView();
  if (!view.you) return { view, message: "Нужно войти." };
  return mutateDurak({ type: "pass", userId: view.you.id });
}

export async function voteDurakModeAction(
  mode: DurakMode,
): Promise<DurakActionResult> {
  const view = await loadDurakView();
  if (!view.you) return { view, message: "Нужно войти." };
  return mutateDurak({ type: "vote-mode", userId: view.you.id, mode });
}

export async function voteDurakBotAction(
  choice: "keep" | "drop",
): Promise<DurakActionResult> {
  const view = await loadDurakView();
  if (!view.you) return { view, message: "Нужно войти." };
  return mutateDurak({ type: "vote-bot", userId: view.you.id, choice });
}

export async function durakVoiceTokenAction(
  guestId: string,
): Promise<DurakVoiceTicket> {
  return issueDurakVoiceToken(guestId);
}
