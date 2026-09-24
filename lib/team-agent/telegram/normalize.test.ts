/**
 * Telegram adapter normalize tests.
 * Run: npx tsx lib/team-agent/telegram/normalize.test.ts
 */
import assert from "node:assert/strict";
import { normalizeTelegramUpdate } from "./normalize";
import type { TelegramUpdate } from "./types";

const config = {
  allowedChatId: "-100123",
  botUsername: "kroogy_bot",
  mentionTokens: ["@kroogy_bot"],
  botUserId: 777,
};

{
  const update: TelegramUpdate = {
    update_id: 1,
    message: {
      message_id: 10,
      date: 1_700_000_000,
      text: "обычный чат",
      from: { id: 42, username: "sam", first_name: "Sam" },
      chat: { id: -100123, type: "supergroup", title: "Team" },
    },
  };
  const n = normalizeTelegramUpdate(update, config);
  assert.equal(n.ignored, false);
  assert.equal(n.ingest?.conversationExternalId, "-100123");
}

{
  const update: TelegramUpdate = {
    update_id: 2,
    message: {
      message_id: 11,
      date: 1_700_000_001,
      text: "hi",
      from: { id: 1, first_name: "X" },
      chat: { id: -999, type: "supergroup", title: "Other" },
    },
  };
  const n = normalizeTelegramUpdate(update, config);
  assert.equal(n.ignored, true);
  assert.equal(n.ignoreReason, "chat_not_allowed");
}

{
  const update: TelegramUpdate = {
    update_id: 3,
    edited_message: {
      message_id: 12,
      date: 1_700_000_002,
      text: "@kroogy_bot ping",
      from: { id: 42, username: "sam", first_name: "Sam" },
      chat: { id: -100123, type: "supergroup", title: "Team" },
      entities: [{ type: "mention", offset: 0, length: 11 }],
    },
  };
  const n = normalizeTelegramUpdate(update, config);
  assert.equal(n.ignored, false);
  assert.equal(n.ingest?.messageType, "edited");
  assert.deepEqual(n.ingest?.metadata.entity_mentions, ["kroogy_bot"]);
}

{
  const update: TelegramUpdate = {
    update_id: 4,
    message: {
      message_id: 13,
      date: 1_700_000_003,
      text: "bot noise",
      from: { id: 777, is_bot: true, username: "kroogy_bot", first_name: "Bot" },
      chat: { id: -100123, type: "supergroup", title: "Team" },
    },
  };
  const n = normalizeTelegramUpdate(update, config);
  assert.equal(n.ignored, true);
  assert.equal(n.ignoreReason, "own_bot_message");
}

console.log("telegram normalize: ok");
