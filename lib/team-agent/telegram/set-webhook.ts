/**
 * Register Telegram webhook for Team Agent (production / tunnel).
 *
 * Run:
 *   npm run team-agent:telegram:setup
 *   # or
 *   npx tsx lib/team-agent/telegram/set-webhook.ts
 *
 * Requires:
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_WEBHOOK_SECRET
 *   TEAM_AGENT_PUBLIC_BASE_URL or NEXT_PUBLIC_SITE_URL
 *     → posts to {base}/api/webhooks/team-agent-telegram
 */
import { loadEnvConfig } from "@next/env";
import { resolveTeamAgentPublicBaseUrl } from "../config";
import {
  telegramGetMe,
  telegramGetWebhookInfo,
  telegramSetWebhook,
} from "./bot-api";

loadEnvConfig(process.cwd());

async function main() {
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) {
    console.error("TELEGRAM_BOT_TOKEN missing");
    process.exit(1);
  }
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error("TELEGRAM_WEBHOOK_SECRET missing (required)");
    process.exit(1);
  }

  const argUrl = process.argv[2]?.trim();
  const base = resolveTeamAgentPublicBaseUrl();
  const url =
    argUrl ||
    (base ? `${base}/api/webhooks/team-agent-telegram` : "");

  if (!url.startsWith("https://")) {
    console.error(
      "Webhook URL must be https. Set TEAM_AGENT_PUBLIC_BASE_URL or pass URL argv.",
    );
    process.exit(1);
  }

  const me = await telegramGetMe();
  if (!me.ok) {
    console.error("getMe failed:", me.error);
    process.exit(1);
  }

  const res = await telegramSetWebhook({ url, secretToken: secret });
  if (!res.ok) {
    console.error("setWebhook failed:", res.error);
    process.exit(1);
  }

  const info = await telegramGetWebhookInfo();
  console.log(`Bot: @${me.result.username ?? "?"}`);
  console.log(`Webhook URL: ${url}`);
  console.log(`Secret: configured (not printed)`);
  if (info.ok) {
    console.log(`Telegram status url=${info.result.url ? "set" : "empty"}`);
    console.log(`pending_update_count=${info.result.pending_update_count}`);
    if (info.result.last_error_message) {
      console.log(`last_error_message=${info.result.last_error_message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
