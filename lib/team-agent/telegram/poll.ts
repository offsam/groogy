/**
 * Local long-poll bootstrap/debug helper (NOT production).
 * Production path = HTTPS webhook + Supabase store.
 *
 * Uses InMemory store only for first wiring / chat discovery support.
 * For durable ingestion use the webhook after migration apply.
 *
 * Run: npm run team-agent:telegram:poll
 */
import { loadEnvConfig } from "@next/env";
import { loadTeamAgentConfig } from "../config";
import { InMemoryTeamAgentStore } from "../store";
import { seedMembersFromTemplate } from "../members";
import {
  telegramDeleteWebhook,
  telegramGetMe,
  telegramGetUpdates,
} from "./bot-api";
import { handleTelegramUpdate } from "./handle-update";
import type { TelegramUpdate } from "./types";

loadEnvConfig(process.cwd());

async function main() {
  const config = loadTeamAgentConfig();
  if (!config.enabled) {
    console.error("TEAM_AGENT_ENABLED must be 1/true");
    process.exit(1);
  }
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) {
    console.error("TELEGRAM_BOT_TOKEN missing");
    process.exit(1);
  }
  if (!config.allowedChatId) {
    console.error("TELEGRAM_ALLOWED_CHAT_ID missing — run team-agent:telegram:bootstrap first");
    process.exit(1);
  }

  const me = await telegramGetMe();
  if (!me.ok) {
    console.error("getMe failed:", me.error);
    process.exit(1);
  }

  await telegramDeleteWebhook();

  const store = new InMemoryTeamAgentStore();
  seedMembersFromTemplate(store);
  let offset = 0;

  console.log(
    `BOOTSTRAP poller @${me.result.username ?? "?"} (in-memory only — not production storage)`,
  );
  console.log(`Listening only to chat ${config.allowedChatId}`);
  console.log("Mention @kroogy_bot or /agent to get a reply.\n");

  for (;;) {
    const updates = await telegramGetUpdates({ offset, timeoutSec: 25 });
    if (!updates.ok) {
      console.error("getUpdates error:", updates.error);
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    for (const raw of updates.result) {
      const update = raw as TelegramUpdate;
      offset = Math.max(offset, update.update_id + 1);
      const result = await handleTelegramUpdate({
        update,
        store,
        botUserId: me.result.id,
      });
      console.log(
        `[update ${update.update_id}] ${result.status}` +
          (result.reason ? ` (${result.reason})` : "") +
          ` providerCalls=${result.providerCalls ?? 0}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
