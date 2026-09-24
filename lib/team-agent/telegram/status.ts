/**
 * Print Telegram webhook status (no secrets).
 * Run: npm run team-agent:telegram:status
 */
import { loadEnvConfig } from "@next/env";
import { telegramGetMe, telegramGetWebhookInfo } from "./bot-api";

loadEnvConfig(process.cwd());

async function main() {
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) {
    console.error("TELEGRAM_BOT_TOKEN missing");
    process.exit(1);
  }
  const me = await telegramGetMe();
  if (!me.ok) {
    console.error("getMe failed:", me.error);
    process.exit(1);
  }
  const info = await telegramGetWebhookInfo();
  console.log(`bot=@${me.result.username ?? "?"} id=${me.result.id}`);
  if (!info.ok) {
    console.error("getWebhookInfo failed:", info.error);
    process.exit(1);
  }
  console.log(`webhook_url=${info.result.url || "(none)"}`);
  console.log(`pending_update_count=${info.result.pending_update_count}`);
  if (info.result.last_error_message) {
    console.log(`last_error=${info.result.last_error_message}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
