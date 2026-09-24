/**
 * Thin Telegram Bot API client (fetch only — no SDK).
 * Token stays server-side; never log the token or full webhook URL with token.
 */

export type TelegramApiResult<T> = {
  ok: true;
  result: T;
} | {
  ok: false;
  error: string;
  retryable: boolean;
};

function botToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const t = env.TELEGRAM_BOT_TOKEN?.trim();
  return t || null;
}

function apiUrl(method: string, token: string): string {
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function callApi<T>(
  method: string,
  body?: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TelegramApiResult<T>> {
  const token = botToken(env);
  if (!token) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN missing", retryable: false };
  }

  const controller = new AbortController();
  // Long-poll getUpdates uses timeout up to ~25s; abort must exceed that.
  const bodyTimeoutSec =
    typeof body?.timeout === "number" && Number.isFinite(body.timeout)
      ? body.timeout
      : 0;
  const abortMs = Math.max(15_000, bodyTimeoutSec * 1000 + 10_000);
  const timer = setTimeout(() => controller.abort(), abortMs);

  try {
    const res = await fetch(apiUrl(method, token), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = (await res.json()) as {
      ok?: boolean;
      description?: string;
      result?: T;
    };
    if (!res.ok || !data.ok) {
      const desc = data.description ?? `http_${res.status}`;
      return {
        ok: false,
        error: desc,
        retryable: res.status >= 500 || res.status === 429,
      };
    }
    return { ok: true, result: data.result as T };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Split long replies under Telegram's 4096 char limit without breaking UTF-16 surrogates badly. */
export function splitTelegramText(text: string, maxLen = 3500): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [""];
  if (trimmed.length <= maxLen) return [trimmed];
  const chunks: string[] = [];
  let rest = trimmed;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf("\n", maxLen);
    if (cut < maxLen * 0.5) cut = rest.lastIndexOf(" ", maxLen);
    if (cut < maxLen * 0.5) cut = maxLen;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export async function telegramSendMessage(input: {
  chatId: string | number;
  text: string;
  replyToMessageId?: number | null;
  env?: NodeJS.ProcessEnv;
}): Promise<TelegramApiResult<{ message_id: number }>> {
  const text = input.text.slice(0, 4096);
  return callApi(
    "sendMessage",
    {
      chat_id: input.chatId,
      text,
      ...(input.replyToMessageId
        ? { reply_to_message_id: input.replyToMessageId }
        : {}),
    },
    input.env ?? process.env,
  );
}

export type TelegramBotIdentity = {
  id: number;
  username: string | null;
  first_name: string;
};

export async function telegramGetMe(
  env: NodeJS.ProcessEnv = process.env,
): Promise<TelegramApiResult<TelegramBotIdentity>> {
  const res = await callApi<{
    id: number;
    username?: string;
    first_name: string;
  }>("getMe", undefined, env);
  if (!res.ok) return res;
  return {
    ok: true,
    result: {
      id: res.result.id,
      username: res.result.username ?? null,
      first_name: res.result.first_name,
    },
  };
}

export async function telegramGetUpdates(input: {
  offset?: number;
  timeoutSec?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<TelegramApiResult<unknown[]>> {
  return callApi(
    "getUpdates",
    {
      offset: input.offset,
      timeout: input.timeoutSec ?? 25,
      allowed_updates: ["message", "edited_message"],
    },
    input.env ?? process.env,
  );
}

export type TelegramWebhookInfo = {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  ip_address?: string;
};

export async function telegramGetWebhookInfo(
  env: NodeJS.ProcessEnv = process.env,
): Promise<TelegramApiResult<TelegramWebhookInfo>> {
  return callApi<TelegramWebhookInfo>("getWebhookInfo", undefined, env);
}

export async function telegramSetWebhook(input: {
  url: string;
  secretToken?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<TelegramApiResult<true>> {
  if (!input.secretToken) {
    return {
      ok: false,
      error: "TELEGRAM_WEBHOOK_SECRET required for setWebhook",
      retryable: false,
    };
  }
  return callApi(
    "setWebhook",
    {
      url: input.url,
      allowed_updates: ["message", "edited_message"],
      drop_pending_updates: false,
      secret_token: input.secretToken,
    },
    input.env ?? process.env,
  );
}

export async function telegramDeleteWebhook(
  env: NodeJS.ProcessEnv = process.env,
): Promise<TelegramApiResult<true>> {
  return callApi("deleteWebhook", { drop_pending_updates: false }, env);
}
