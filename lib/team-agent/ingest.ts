/**
 * Source-agnostic message ingestion (Telegram is an adapter, not a dependency).
 */

import { loadTeamAgentConfig } from "./config";
import { shouldAgentRespond } from "./response-policy";
import type { TeamAgentStore } from "./store-port";
import type {
  IngestTeamMessageInput,
  IngestTeamMessageResult,
  TeamAgentMember,
  TeamAgentMessage,
} from "./types";

function parseSenderId(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

export async function resolveMemberFromExternalIdentity(
  store: TeamAgentStore,
  senderExternalId: string | null,
  senderUsername: string | null,
): Promise<{ member: TeamAgentMember | null; unknownSender: boolean }> {
  const tid = parseSenderId(senderExternalId);
  if (tid != null) {
    const byId = await store.findMemberByTelegramUserId(tid);
    if (!byId) return { member: null, unknownSender: true };
    const username = senderUsername?.replace(/^@/, "") ?? null;
    const current = byId.telegram_username?.replace(/^@/, "") ?? null;
    if (username && username.toLowerCase() !== current?.toLowerCase()) {
      const updated = await store.upsertMember({
        ...byId,
        telegram_username: username,
      });
      return { member: updated, unknownSender: false };
    }
    return { member: byId, unknownSender: false };
  }
  if (senderUsername) {
    const byName = await store.findMemberByTelegramUsername(senderUsername);
    if (byName) return { member: byName, unknownSender: false };
  }
  return { member: null, unknownSender: true };
}

export async function ingestTeamMessage(
  store: TeamAgentStore,
  input: IngestTeamMessageInput,
): Promise<IngestTeamMessageResult> {
  const config = loadTeamAgentConfig();
  const conversation = await store.findOrCreateConversation({
    source_type: input.source,
    external_conversation_id: input.conversationExternalId,
    title: input.conversationTitle,
  });

  const { member, unknownSender } = await resolveMemberFromExternalIdentity(
    store,
    input.senderExternalId,
    input.senderUsername,
  );

  if (input.messageExternalId) {
    const existing = await store.findMessageByExternal(
      conversation.id,
      input.messageExternalId,
    );
    if (existing) {
      // Edited Telegram messages reuse the same message_id — update body in place.
      const isEdit = input.messageType === "edited" || Boolean(input.metadata?.edited);
      let message = existing;
      if (isEdit && input.text !== existing.body) {
        message = await store.updateMessage(existing.id, {
          body: input.text ?? existing.body,
          message_type: "edited",
          occurred_at: input.timestamp ?? existing.occurred_at,
          metadata: {
            ...existing.metadata,
            ...(input.metadata ?? {}),
            edited: true,
            previous_body: existing.body,
          },
        });
      }

      const alreadyReplied = message.metadata?.agent_replied === true;
      const policy = shouldAgentRespond(
        {
          text: message.body,
          isBotMessage: message.message_type === "bot",
          mentionTokens: input.mentionTokens,
          explicitCommands: input.explicitCommands,
          botUsername: input.botUsername ?? config.botUsername,
          metadata: {
            ...message.metadata,
            ...(input.metadata ?? {}),
          },
        },
        config,
      );

      return {
        conversation,
        message,
        member,
        unknownSender,
        duplicate: !isEdit,
        shouldRespond: policy.respond && !alreadyReplied,
        respondReason: alreadyReplied
          ? "already_replied"
          : policy.reason,
      };
    }
  }

  let replyToId: string | null = null;
  if (input.replyToExternalMessageId) {
    const parent = await store.findMessageByExternal(
      conversation.id,
      input.replyToExternalMessageId,
    );
    replyToId = parent?.id ?? null;
  }

  const occurredAt = input.timestamp ?? new Date().toISOString();
  const message = await store.insertMessage({
    conversation_id: conversation.id,
    member_id: member?.id ?? null,
    external_message_id: input.messageExternalId,
    reply_to_message_id: replyToId,
    message_type: input.messageType ?? "text",
    body: input.text ?? "",
    metadata: {
      ...(input.metadata ?? {}),
      senderExternalId: input.senderExternalId,
      senderUsername: input.senderUsername,
      unknownSender,
    },
    occurred_at: occurredAt,
  });

  const policy = shouldAgentRespond(
    {
      text: message.body,
      isBotMessage: message.message_type === "bot",
      mentionTokens: input.mentionTokens,
      explicitCommands: input.explicitCommands,
      botUsername: input.botUsername ?? config.botUsername,
      metadata: message.metadata,
    },
    config,
  );

  return {
    conversation,
    message,
    member,
    unknownSender,
    duplicate: false,
    shouldRespond: policy.respond,
    respondReason: policy.reason,
  };
}

export async function markMessageAgentReplied(
  store: TeamAgentStore,
  messageId: string,
  agentReplyMessageId?: string | null,
): Promise<void> {
  await store.updateMessage(messageId, {
    metadata: {
      agent_replied: true,
      agent_replied_at: new Date().toISOString(),
      ...(agentReplyMessageId
        ? { agent_reply_message_id: agentReplyMessageId }
        : {}),
    },
  });
}

/** Stable id so a webhook retry cannot insert a second bot row. */
export function agentReplyExternalId(
  triggerExternalMessageId: string | null | undefined,
): string | null {
  if (!triggerExternalMessageId) return null;
  return `agent:${triggerExternalMessageId}`;
}

/**
 * Persist the bot reply in the same conversation.
 * member_id stays null — the bot is not a team member.
 * message_type=bot + metadata.role=agent distinguishes it from humans.
 */
export async function claimAgentReply(
  store: TeamAgentStore,
  input: {
    conversationId: string;
    triggerMessage: { id: string; external_message_id: string | null };
    requestId: string;
  },
): Promise<{ claimed: boolean; message: TeamAgentMessage | null }> {
  const externalId = agentReplyExternalId(input.triggerMessage.external_message_id);
  if (!externalId) return { claimed: false, message: null };
  const existing = await store.findMessageByExternal(input.conversationId, externalId);
  if (existing) {
    const state = existing.metadata.agent_state;
    const stale =
      state === "processing" &&
      !existing.body &&
      Date.now() - new Date(existing.occurred_at).getTime() > 45_000;
    if (stale) {
      const taken = await store.updateMessage(existing.id, {
        metadata: { ...existing.metadata, request_id: input.requestId, agent_state: "processing" },
      });
      return { claimed: true, message: taken };
    }
    return { claimed: false, message: existing };
  }
  try {
    const row = await store.insertMessage({
      conversation_id: input.conversationId,
      member_id: null,
      external_message_id: externalId,
      reply_to_message_id: input.triggerMessage.id,
      message_type: "bot",
      body: "",
      occurred_at: new Date().toISOString(),
      metadata: {
        role: "agent",
        source: "bot",
        agent_state: "processing",
        request_id: input.requestId,
      },
    });
    if (row.metadata.request_id !== input.requestId) {
      return { claimed: false, message: row };
    }
    return { claimed: true, message: row };
  } catch {
    const raced = await store.findMessageByExternal(input.conversationId, externalId);
    return { claimed: false, message: raced };
  }
}

export async function persistAgentReply(
  store: TeamAgentStore,
  input: {
    conversationId: string;
    triggerMessage: { id: string; external_message_id: string | null };
    replyText: string;
    telegramMessageIds?: number[];
    provider?: string | null;
    model?: string | null;
    responseId?: string | null;
    usage?: Record<string, unknown> | null;
    topicIds?: string[];
    updateId?: number | null;
    requestId?: string | null;
    agentState?: string;
  },
): Promise<{ message: TeamAgentMessage; created: boolean }> {
  const externalId = agentReplyExternalId(input.triggerMessage.external_message_id);
  const metadata = {
    role: "agent",
    source: "bot",
    provider: input.provider ?? null,
    model: input.model ?? null,
    response_id: input.responseId ?? null,
    usage: input.usage ?? null,
    topic_ids: input.topicIds ?? [],
    created_at: new Date().toISOString(),
    trigger_message_id: input.triggerMessage.id,
    trigger_external_message_id: input.triggerMessage.external_message_id,
    trigger_update_id: input.updateId ?? null,
    telegram_message_ids: input.telegramMessageIds ?? [],
    agent_state: input.agentState ?? "completed",
    request_id: input.requestId ?? null,
  };
  if (externalId) {
    const existing = await store.findMessageByExternal(
      input.conversationId,
      externalId,
    );
    if (existing) {
      const message = await store.updateMessage(existing.id, {
        body: input.replyText,
        metadata,
      });
      return { message, created: false };
    }
  }

  const message = await store.insertMessage({
    conversation_id: input.conversationId,
    member_id: null,
    external_message_id: externalId,
    reply_to_message_id: input.triggerMessage.id,
    message_type: "bot",
    body: input.replyText,
    occurred_at: new Date().toISOString(),
    metadata,
  });
  return { message, created: true };
}
