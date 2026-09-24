/**
 * Print chat ids from recent updates so you can set TELEGRAM_ALLOWED_CHAT_ID.
 *
 * 1. Add the bot to the private team group
 * 2. Write any message in the group
 * 3. Run: npx tsx lib/team-agent/telegram/discover-chat.ts
 */
import { loadEnvConfig } from "@next/env";
import {
  telegramDeleteWebhook,
  telegramGetMe,
  telegramGetUpdates,
} from "./bot-api";
import type { TelegramUpdate } from "./types";

loadEnvConfig(process.cwd());

async function main() {
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) {
    console.error("TELEGRAM_BOT_TOKEN missing in env");
    process.exit(1);
  }

  const me = await telegramGetMe();
  if (!me.ok) {
    console.error("getMe failed:", me.error);
    process.exit(1);
  }

  await telegramDeleteWebhook();

  const updates = await telegramGetUpdates({ timeoutSec: 0 });
  if (!updates.ok) {
    console.error("getUpdates failed:", updates.error);
    process.exit(1);
  }

  console.log(`Bot @${me.result.username ?? "?"} id=${me.result.id}`);
  if (updates.result.length === 0) {
    console.log(
      "No updates yet. Add the bot to the group, send a message, then re-run.",
    );
    return;
  }

  const seen = new Set<string>();
  for (const raw of updates.result) {
    const u = raw as TelegramUpdate;
    const msg = u.message ?? u.edited_message;
    if (!msg) continue;
    const key = String(msg.chat.id);
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(
      `chat_id=${msg.chat.id} type=${msg.chat.type} title=${msg.chat.title ?? msg.chat.username ?? "?"}`,
    );
  }

  console.log(
    "\nPut the group chat_id into TELEGRAM_ALLOWED_CHAT_ID in .env.local",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
