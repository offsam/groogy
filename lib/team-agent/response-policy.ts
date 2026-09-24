/**
 * Pure response policy: listen always, respond only on explicit invocation.
 *
 * Explicit invocation =
 *  1) Telegram entity mention of the bot (@kroogy_bot)
 *  2) allowlisted bot_command entity (/agent, /agent@kroogy_bot)
 *  3) reply to the bot's own message
 *
 * Do NOT respond to bare words like «бот», «агент», «Kroogy», «AI».
 */

import type { TeamAgentConfig } from "./config";

export type ResponsePolicyInput = {
  text: string;
  isBotMessage?: boolean;
  mentionTokens?: string[];
  explicitCommands?: string[];
  botUsername?: string | null;
  metadata?: Record<string, unknown>;
};

export type ResponsePolicyResult = {
  listen: true;
  respond: boolean;
  reason: string | null;
};

function normalizeBotUsername(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const u = raw.trim().replace(/^@/, "").toLowerCase();
  return u || null;
}

function entityMentionsBot(
  metadata: Record<string, unknown> | undefined,
  botUsername: string | null,
): boolean {
  if (!botUsername) return false;
  const entityMentions = Array.isArray(metadata?.entity_mentions)
    ? (metadata!.entity_mentions as unknown[]).map((x) =>
        String(x).replace(/^@/, "").toLowerCase(),
      )
    : [];
  if (entityMentions.includes(botUsername)) return true;

  const mentions = Array.isArray(metadata?.mentions)
    ? (metadata!.mentions as unknown[]).map((x) =>
        String(x).replace(/^@/, "").toLowerCase(),
      )
    : [];
  return mentions.includes(botUsername);
}

function entityHasBotCommand(
  metadata: Record<string, unknown> | undefined,
  commands: string[],
  botUsername: string | null,
): boolean {
  const entityCommands = Array.isArray(metadata?.entity_commands)
    ? (metadata!.entity_commands as unknown[]).map((x) => String(x).toLowerCase())
    : [];

  for (const raw of entityCommands) {
    const base = raw.split("@")[0] ?? raw;
    for (const cmd of commands) {
      const c = cmd.toLowerCase();
      if (!c.startsWith("/")) continue;
      if (base === c || raw === `${c}@${botUsername}`) return true;
    }
  }
  return false;
}

export function shouldAgentRespond(
  message: ResponsePolicyInput,
  config?: Pick<
    TeamAgentConfig,
    "mentionTokens" | "explicitCommands" | "botUsername"
  >,
): ResponsePolicyResult {
  if (message.isBotMessage) {
    return { listen: true, respond: false, reason: "bot_message" };
  }

  const text = (message.text ?? "").trim();
  if (!text) {
    return { listen: true, respond: false, reason: "empty" };
  }

  const botUsername = normalizeBotUsername(
    message.botUsername ?? config?.botUsername ?? null,
  );

  const commands = [
    ...(config?.explicitCommands ?? []),
    ...(message.explicitCommands ?? []),
  ]
    .map((t) => t.toLowerCase())
    .filter((c) => c.startsWith("/"));

  // Prefer Telegram entities when present.
  if (entityMentionsBot(message.metadata, botUsername)) {
    return { listen: true, respond: true, reason: "mention" };
  }

  if (entityHasBotCommand(message.metadata, commands, botUsername)) {
    return { listen: true, respond: true, reason: "command" };
  }

  if (message.metadata?.reply_to_bot === true) {
    return { listen: true, respond: true, reason: "reply_to_bot" };
  }

  if (message.metadata?.directInvocation === true) {
    return { listen: true, respond: true, reason: "direct_invocation" };
  }

  // Fallback for fixtures / non-Telegram sources: exact @botUsername token only.
  const lower = text.toLowerCase();
  if (botUsername) {
    const token = `@${botUsername}`;
    if (lower.includes(token)) {
      return { listen: true, respond: true, reason: "mention" };
    }
  }

  for (const cmd of commands) {
    if (lower === cmd || lower.startsWith(`${cmd} `) || lower.startsWith(`${cmd}@`)) {
      return { listen: true, respond: true, reason: "command" };
    }
  }

  return { listen: true, respond: false, reason: null };
}
