/**
 * Telegram update → ingest → optional agent reply.
 * Production path uses Supabase store; tests inject InMemory.
 */

import { MockTeamAgentProvider } from "../agent-provider";
import type { TeamAgentProvider } from "../agent-provider";
import { loadTeamAgentConfig } from "../config";
import { buildTeamAgentContext } from "../context";
import { executeValidatedAction } from "../actions";
import {
  agentReplyExternalId,
  ingestTeamMessage,
  markMessageAgentReplied,
  persistAgentReply,
} from "../ingest";
import { MockRepositoryContextProvider } from "../repository-context";
import { linkMessageToTopics } from "../topics";
import {
  DeterministicTopicClassifier,
  resolveInvocationTopics,
  type TopicClassifier,
} from "../topic-classifier";
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
  topicClassifier?: TopicClassifier;
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

  let selectedTopicIds: string[] = [];
  if (ingest.shouldRespond) {
    const selection = await resolveInvocationTopics(
      input.store,
      ingest.message,
      input.topicClassifier ?? new DeterministicTopicClassifier(),
    );
    selectedTopicIds = [
      ...(selection.primaryTopicId ? [selection.primaryTopicId] : []),
      ...selection.secondaryTopicIds,
    ];
  }

  // Reply already stored (crash between persist and the replied flag).
  const agentExternalId = agentReplyExternalId(ingest.message.external_message_id);
  if (agentExternalId) {
    const existingReply = await input.store.findMessageByExternal(
      ingest.conversation.id,
      agentExternalId,
    );
    if (existingReply) {
      await markMessageAgentReplied(
        input.store,
        ingest.message.id,
        existingReply.id,
      );
      return {
        status: "ingested",
        reason: "already_replied",
        shouldRespond: false,
        providerCalls: 0,
        stored: true,
      };
    }
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
    const extraTopicIds = (reply.topicIds ?? []).filter(
      (id) => selectedTopicIds.includes(id) || Boolean(id),
    );
    const knownIds = new Set((await input.store.listTopics()).map((t) => t.id));
    for (const id of extraTopicIds) {
      if (knownIds.has(id) && !selectedTopicIds.includes(id) && selectedTopicIds.length < 3) {
        selectedTopicIds.push(id);
      }
    }
    if (selectedTopicIds.length) {
      await linkMessageToTopics(input.store, ingest.message.id, selectedTopicIds);
    }
    for (const update of reply.summaryUpdates ?? []) {
      if (!knownIds.has(update.topicId)) continue;
      const topic = await input.store.getTopicById(update.topicId);
      if (!topic) continue;
      await input.store.upsertTopic({
        ...topic,
        summary: update.summary.slice(0, 4000),
        metadata: {
          ...topic.metadata,
          summary_updated_at: new Date().toISOString(),
          summary_source: "provider",
          summary_version: Number(topic.metadata.summary_version ?? 0) + 1,
        },
      });
    }

    if (canApplyActions) {
      for (const action of reply.proposedActions) {
        const executed = await executeValidatedAction(input.store, action);
        const result = executed.result as { id?: string } | null;
        if (!result?.id || selectedTopicIds.length === 0) continue;
        if (action.type === "create_task") {
          for (const topicId of selectedTopicIds) {
            await input.store.linkSubjectToTopic({ topicId, taskId: result.id });
          }
        }
        if (action.type === "record_decision") {
          for (const topicId of selectedTopicIds) {
            await input.store.linkSubjectToTopic({ topicId, decisionId: result.id });
          }
        }
        if (action.type === "record_memory") {
          for (const topicId of selectedTopicIds) {
            await input.store.linkSubjectToTopic({ topicId, memoryId: result.id });
          }
        }
      }
    }

    const chunks = splitTelegramText(reply.replyText);
    const telegramMessageIds: number[] = [];
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
      if (typeof send.result.message_id === "number") {
        telegramMessageIds.push(send.result.message_id);
      }
    }

    const persisted = await persistAgentReply(input.store, {
      conversationId: ingest.conversation.id,
      triggerMessage: ingest.message,
      replyText: reply.replyText,
      telegramMessageIds,
      provider: reply.provider ?? "mock",
      model: reply.model ?? null,
      responseId: reply.responseId ?? null,
      usage: reply.usage ?? null,
      updateId: input.update.update_id,
    });
    await linkMessageToTopics(
      input.store,
      persisted.message.id,
      selectedTopicIds,
    );
    await markMessageAgentReplied(
      input.store,
      ingest.message.id,
      persisted.message.id,
    );

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
