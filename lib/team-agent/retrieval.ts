/**
 * Bounded lexical retrieval for messages that are not yet linked to a topic.
 * No model call.
 */

import type { TeamAgentMessage } from "./types";

const STOP = new Set([
  "что",
  "как",
  "это",
  "для",
  "или",
  "мы",
  "вы",
  "нас",
  "нам",
  "про",
  "по",
  "на",
  "и",
  "в",
  "с",
  "к",
  "the",
  "and",
  "bot",
  "agent",
]);

export function queryTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s-]/gi, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOP.has(token));
}

export function lexicalScore(query: string, body: string): number {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return 0;
  const hay = body.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    const stem = token.length >= 5 ? token.slice(0, 5) : token;
    if (hay.includes(token) || (stem.length >= 5 && hay.includes(stem))) {
      score += token.length >= 6 ? 2 : 1;
    }
  }
  return score;
}

/**
 * Recent messages that share words with the question but are not topic-linked yet.
 * Reply parent is kept when it is in the same window.
 */
export function pickUnlinkedMessages(
  recent: TeamAgentMessage[],
  linkedIds: Set<string>,
  query: string,
  replyToMessageId: string | null,
  limit: number,
  excludeId?: string | null,
): TeamAgentMessage[] {
  const picked: TeamAgentMessage[] = [];
  if (replyToMessageId && replyToMessageId !== excludeId) {
    const parent = recent.find((message) => message.id === replyToMessageId);
    if (parent && !linkedIds.has(parent.id)) picked.push(parent);
  }
  const ranked = recent
    .filter(
      (message) =>
        message.id !== excludeId &&
        !linkedIds.has(message.id) &&
        message.message_type !== "bot",
    )
    .map((message) => ({ message, score: lexicalScore(query, message.body) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.message.occurred_at.localeCompare(a.message.occurred_at));
  for (const row of ranked) {
    if (picked.length >= limit) break;
    if (picked.some((message) => message.id === row.message.id)) continue;
    picked.push(row.message);
  }
  return picked.slice(0, limit);
}
