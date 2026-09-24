/**
 * Telegram update → ingest → optional agent reply.
 * Production path uses Supabase store; tests inject InMemory.
 */

import { MockTeamAgentProvider } from "../agent-provider";
import type { TeamAgentProvider } from "../agent-provider";
import { loadTeamAgentConfig } from "../config";
import { buildTeamAgentContext } from "../context";
import { executeValidatedAction } from "../actions";
import { ingestTeamMessage, markMessageAgentReplied } from "../ingest";
import { MockRepositoryContextProvider } from "../repository-context";
import type { TeamAgentStore } from "../store-port";
import { splitTelegramText, telegramSendMessage } from "./bot-api";
import { normalizeTelegramUpdate } from "./normalize";
import type { TelegramUpdate } from "./types";

export type HandleTelegramUpdateResult = {
  status:
    | "disabled"
    | "ignored"
    | "ingested"
    | "replied"
    | "provider_error";
  reason?: string;
  shouldRespond?: boolean;
  replySent?: boolean;
  providerCalls?: number;
  stored?: boolean;
};

export async function handleTelegramUpdate(input: {
  update: TelegramUpdate;
  store: TeamAgentStore;
  env?: NodeJS.ProcessEnv;
  provider?: TeamAgentProvider;
  botUserId?: number | null;
  /** When false, skip privileged action execution for unknown members (default). */
  allowUnknownPrivilegedActions?: boolean;
}): Promise<HandleTelegramUpdateResult> {
  const env = input.env ?? process.env;
  const config = loadTeamAgentConfig(env);

  if (!config.enabled) {
    return { status: "disabled", reason: "TEAM_AGENT_ENABLED off", providerCalls: 0, stored: false };
  }

  const normalized = normalizeTelegramUpdate(input.update, {
    ...config,
    botUserId: input.botUserId ?? null,
  });
  if (normalized.ignored || !normalized.ingest) {
    return {
      status: "ignored",
      reason: normalized.ignoreReason,
      providerCalls: 0,
      stored: false,
    };
  }

  const ingest = await ingestTeamMessage(input.store, {
    ...normalized.ingest,
    botUsername: config.botUsername,
    mentionTokens: config.mentionTokens,
    explicitCommands: config.explicitCommands,
  });

  if (!ingest.shouldRespond) {
    return {
      status: "ingested",
      reason: ingest.duplicate
        ? ingest.respondReason ?? "duplicate"
        : ingest.respondReason ?? "listen_only",
      shouldRespond: false,
      providerCalls: 0,
      stored: true,
    };
  }

  // Duplicate webhook retry after a successful reply — do not call provider again.
  if (ingest.duplicate && ingest.respondReason === "already_replied") {
    return {
      status: "ingested",
      reason: "already_replied",
      shouldRespond: false,
      providerCalls: 0,
      stored: true,
    };
  }

  let providerCalls = 0;
  try {
    const context = await buildTeamAgentContext(input.store, {
      conversationId: ingest.conversation.id,
      requestingMember: ingest.member,
      triggerMessage: ingest.message,
      repositoryProvider: new MockRepositoryContextProvider(),
      maxMessages: config.maxContextMessages,
    });

    const provider = input.provider ?? new MockTeamAgentProvider();
    providerCalls += 1;
    const reply = await provider.respond(
      context,
      {
        triggerMessage: ingest.message,
        userText: ingest.message.body,
      },
      input.store,
    );

    const canApplyActions =
      Boolean(ingest.member) || Boolean(input.allowUnknownPrivilegedActions);
    if (canApplyActions) {
      for (const action of reply.proposedActions) {
        await executeValidatedAction(input.store, action);
      }
    }

    const chunks = splitTelegramText(reply.replyText);
    for (const [i, chunk] of chunks.entries()) {
      const send = await telegramSendMessage({
        chatId: normalized.ingest.conversationExternalId,
        text: chunk,
        replyToMessageId:
          i === 0 ? Number(normalized.ingest.messageExternalId) || null : null,
        env,
      });
      if (!send.ok) {
        return {
          status: "provider_error",
          reason: send.error,
          shouldRespond: true,
          replySent: false,
          providerCalls,
          stored: true,
        };
      }
    }

    await markMessageAgentReplied(input.store, ingest.message.id);

    return {
      status: "replied",
      shouldRespond: true,
      replySent: true,
      providerCalls,
      stored: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await telegramSendMessage({
      chatId: normalized.ingest.conversationExternalId,
      text: "Team Agent временно недоступен. Попробуйте ещё раз чуть позже.",
      replyToMessageId: Number(normalized.ingest.messageExternalId) || null,
      env,
    });
    return {
      status: "provider_error",
      reason: msg,
      shouldRespond: true,
      replySent: false,
      providerCalls,
      stored: true,
    };
  }
}
