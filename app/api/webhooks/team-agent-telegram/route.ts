import { NextResponse } from "next/server";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { loadTeamAgentConfig } from "@/lib/team-agent/config";
import { telegramGetMe } from "@/lib/team-agent/telegram/bot-api";
import { handleTelegramUpdate } from "@/lib/team-agent/telegram/handle-update";
import { getTeamAgentProductionStore } from "@/lib/team-agent/telegram/runtime-store";
import type { TelegramUpdate } from "@/lib/team-agent/telegram/types";
import { verifyTelegramWebhookSecret } from "@/lib/team-agent/telegram/webhook-auth";

export const runtime = "nodejs";

/**
 * Telegram Bot webhook for internal Team Agent (@kroogy_bot).
 * Auth: X-Telegram-Bot-Api-Secret-Token (required when enabled).
 * Persistence: Supabase service_role (team_agent_*).
 */

export async function POST(request: Request) {
  const config = loadTeamAgentConfig();
  if (!config.enabled) {
    return NextResponse.json({ ok: true, status: "disabled" });
  }

  if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const auth = verifyTelegramWebhookSecret({
    expected: process.env.TELEGRAM_WEBHOOK_SECRET,
    provided: request.headers.get("x-telegram-bot-api-secret-token"),
  });
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const limited = consumeRateLimit("team-agent-telegram-webhook", {
    limit: 120,
    windowMs: 60 * 1000,
  });
  if (!limited.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof update?.update_id !== "number") {
    return NextResponse.json({ error: "invalid_update" }, { status: 400 });
  }

  try {
    const me = await telegramGetMe();
    const botUserId = me.ok ? me.result.id : null;
    const store = getTeamAgentProductionStore();
    const result = await handleTelegramUpdate({
      update,
      store,
      botUserId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}

/** Health probe — no secrets. */
export async function GET() {
  const config = loadTeamAgentConfig();
  return NextResponse.json({
    ok: true,
    enabled: config.enabled,
    hasToken: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
    hasWebhookSecret: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET?.trim()),
    hasAllowedChat: Boolean(config.allowedChatId),
    botUsername: config.botUsername,
    provider: config.provider,
    model: config.model,
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
  });
}
