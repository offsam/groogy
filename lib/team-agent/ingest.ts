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
    if (byId) return { member: byId, unknownSender: false };
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
): Promise<void> {
  await store.updateMessage(messageId, {
    metadata: { agent_replied: true, agent_replied_at: new Date().toISOString() },
  });
}
