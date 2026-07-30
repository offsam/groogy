/**
 * Extract profile updates (новости) from free-text ads.
 * News is not a service and not a promotion.
 */

import type { QueueUpdate } from "@/types/update";

/** Signals that the post is a life/status update, not a price-list service. */
export const UPDATE_SIGNAL_RE =
  /(?:переехал\p{L}*|переехал[аи]?|переехала|переезд|открыл\p{L}*|открыла|открытие|новый\s+(?:уютный\s+)?(?:кабинет|офис|салон|локаци\p{L}*)|новом\s+(?:уютном\s+)?(?:месте|кабинете|офисе|салоне)|отличные\s+новости|хорошие\s+новости|рады?\s+сообщить|теперь\s+я\s+работаю|теперь\s+работаю|в\s+честь\s+(?:этого|открытия)|special\s+offer\s+is\s+available|moved\s+to\s+(?:a\s+)?new|new\s+(?:location|office|studio|space)|grand\s+opening)/iu;

const GREETING_RE =
  /^(?:всем\s+)?(?:здравствуйте|здравствуй|привет(?:ствую)?|добрый\s+день|добрый\s+вечер|доброе\s+утро|hello|hi|hey)[\s,!.:;—–-]*/iu;

const VOCATIVE_RE =
  /^(?:дорог\p{L}+\s+)?(?:девочк\p{L}+|девушк\p{L}+|дам\p{L}+|мамочки|мамы|друзья|ребят\p{L}+|всем)[\s,!.:;—–-]+/iu;

const PRICE_ONLY_LINE_RE =
  /^.{0,40}?\s*[-—–:]*\s*(?:от|from)?\s*[$₽]?\s*\d{1,5}(?:[.,]\d{2})?\s*(?:\$|usd|долл\p{L}*|руб\p{L}*)?\s*$/iu;

function stripOpeners(text: string): string {
  let t = text.trim();
  for (let i = 0; i < 3; i += 1) {
    const next = t
      .replace(GREETING_RE, "")
      .replace(VOCATIVE_RE, "")
      .replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, "")
      .trim();
    if (next === t) break;
    t = next;
  }
  return t;
}

function firstMeaningfulLine(block: string): string {
  for (const line of block.split("\n")) {
    const t = stripOpeners(line);
    if (t.length >= 8) return t.slice(0, 160);
  }
  return "Обновление";
}

/**
 * True when a candidate service title is actually a news/update opener.
 * Used to keep such lines out of `professional_services`.
 */
export function isNewsUpdateTitle(title: string | null | undefined): boolean {
  const t = stripOpeners(String(title || "").trim());
  if (!t || t.length < 4) return false;
  if (PRICE_ONLY_LINE_RE.test(t)) return false;
  return UPDATE_SIGNAL_RE.test(t);
}

/**
 * Pull update blocks from an ad. Prefer whole post when it has update signals.
 */
export function updatesFromAdText(
  text: string | null | undefined,
): QueueUpdate[] {
  if (!text?.trim()) return [];
  const full = text.trim();
  if (!UPDATE_SIGNAL_RE.test(full)) return [];

  const title = firstMeaningfulLine(full);
  if (title.length < 8) return [];

  return [
    {
      title,
      body: full.slice(0, 2000),
    },
  ];
}
