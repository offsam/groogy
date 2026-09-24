/**
 * Minimal Telegram Bot API shapes used by the adapter.
 * Domain layer must not depend on Telegram SDK — these are adapter-local.
 */

export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramChat = {
  id: number;
  type: string;
  title?: string;
  username?: string;
};

export type TelegramMessageEntity = {
  type: string;
  offset: number;
  length: number;
  user?: TelegramUser;
};

export type TelegramMessage = {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
  from?: TelegramUser;
  chat: TelegramChat;
  reply_to_message?: {
    message_id: number;
    from?: TelegramUser;
  };
  entities?: TelegramMessageEntity[];
  caption_entities?: TelegramMessageEntity[];
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
};

export type NormalizedTelegramIngest = {
  ignored: boolean;
  ignoreReason?: string;
  ingest?: {
    source: "telegram";
    conversationExternalId: string;
    conversationTitle?: string;
    messageExternalId: string;
    senderExternalId: string | null;
    senderUsername: string | null;
    text: string;
    replyToExternalMessageId: string | null;
    timestamp: string;
    messageType: "text" | "bot" | "edited";
    metadata: Record<string, unknown>;
    botUsername: string | null;
    mentionTokens: string[];
  };
};
