/**
 * Pure Telegram Update → domain ingest mapping (no network, no secrets).
 */

import type { TeamAgentConfig } from "../config";
import type {
  NormalizedTelegramIngest,
  TelegramMessage,
  TelegramUpdate,
} from "./types";

function extractEntityMentions(message: TelegramMessage): string[] {
  const text = message.text ?? message.caption ?? "";
  const entities = message.entities ?? message.caption_entities ?? [];
  const out: string[] = [];
  for (const e of entities) {
    if (e.type === "mention") {
      const slice = text.slice(e.offset, e.offset + e.length);
      if (slice) out.push(slice.replace(/^@/, ""));
    }
    if (e.type === "text_mention" && e.user?.username) {
      out.push(e.user.username.replace(/^@/, ""));
    }
  }
  return out;
}

function extractEntityCommands(message: TelegramMessage): string[] {
  const text = message.text ?? message.caption ?? "";
  const entities = message.entities ?? message.caption_entities ?? [];
  const out: string[] = [];
  for (const e of entities) {
    if (e.type !== "bot_command") continue;
    const slice = text.slice(e.offset, e.offset + e.length).toLowerCase();
    if (slice) out.push(slice);
  }
  return out;
}

function pickMessage(update: TelegramUpdate): {
  message: TelegramMessage;
  edited: boolean;
} | null {
  if (update.message) return { message: update.message, edited: false };
  if (update.edited_message) {
    return { message: update.edited_message, edited: true };
  }
  if (update.channel_post || update.edited_channel_post) {
    return null;
  }
  return null;
}

function isOurBot(
  user: { id?: number; username?: string; is_bot?: boolean } | undefined,
  config: { botUsername?: string | null; botUserId?: number | null },
): boolean {
  if (!user?.is_bot) return false;
  if (config.botUserId != null && user.id === config.botUserId) return true;
  if (
    config.botUsername &&
    user.username?.toLowerCase() === config.botUsername.toLowerCase()
  ) {
    return true;
  }
  return false;
}

/**
 * Normalize a Telegram update for Team Agent ingest.
 */
export function normalizeTelegramUpdate(
  update: TelegramUpdate,
  config: Pick<TeamAgentConfig, "allowedChatId" | "botUsername" | "mentionTokens"> & {
    botUserId?: number | null;
  },
): NormalizedTelegramIngest {
  const picked = pickMessage(update);
  if (!picked) {
    return { ignored: true, ignoreReason: "unsupported_update" };
  }

  const { message, edited } = picked;
  const chatId = String(message.chat.id);

  if (config.allowedChatId && chatId !== config.allowedChatId) {
    return { ignored: true, ignoreReason: "chat_not_allowed" };
  }

  if (!config.allowedChatId) {
    return { ignored: true, ignoreReason: "allowed_chat_not_configured" };
  }

  const from = message.from;

  if (isOurBot(from, config) || Boolean(from?.is_bot)) {
    return {
      ignored: true,
      ignoreReason: isOurBot(from, config) ? "own_bot_message" : "bot_message",
    };
  }

  const text = (message.text ?? message.caption ?? "").trim();
  const entityMentions = extractEntityMentions(message);
  const entityCommands = extractEntityCommands(message);
  const replyToOurBot = isOurBot(message.reply_to_message?.from, config);

  return {
    ignored: false,
    ingest: {
      source: "telegram",
      conversationExternalId: chatId,
      conversationTitle: message.chat.title ?? message.chat.username ?? "Telegram",
      messageExternalId: String(message.message_id),
      senderExternalId: from ? String(from.id) : null,
      senderUsername: from?.username ?? null,
      text,
      replyToExternalMessageId: message.reply_to_message
        ? String(message.reply_to_message.message_id)
        : null,
      timestamp: new Date(message.date * 1000).toISOString(),
      messageType: edited ? "edited" : "text",
      metadata: {
        update_id: update.update_id,
        chat_type: message.chat.type,
        mentions: entityMentions,
        entity_mentions: entityMentions,
        entity_commands: entityCommands,
        from_first_name: from?.first_name ?? null,
        from_last_name: from?.last_name ?? null,
        edited,
        reply_to_bot: replyToOurBot,
        telegram_thread_id:
          typeof message.message_thread_id === "number" ? message.message_thread_id : null,
      },
      botUsername: config.botUsername,
      mentionTokens: [
        ...config.mentionTokens,
        ...entityMentions.map((m) => `@${m}`),
      ],
    },
  };
}
