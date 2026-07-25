import "server-only";

/** Strip API keys and bearer tokens from strings before logging or error surfaces. */
export function redactSecrets(text: string): string {
  return text
    .replace(/sk-or-v1-[a-zA-Z0-9]+/g, "[redacted-openrouter]")
    .replace(/sk-ant-[a-zA-Z0-9_-]+/g, "[redacted-anthropic]")
    .replace(/sk-[a-zA-Z0-9]{20,}/g, "[redacted-openai]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted-google]")
    .replace(/gsk_[a-zA-Z0-9]+/g, "[redacted-groq]")
    .replace(/sb_secret_[a-zA-Z0-9_-]+/g, "[redacted-supabase]")
    .replace(/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, "[redacted-jwt]")
    .replace(/Bearer\s+[a-zA-Z0-9._\-]+/gi, "Bearer [redacted]")
    .replace(
      /(OPENROUTER_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY|GROQ_API_KEY|DEEPSEEK_API_KEY|TELEGRAM_API_HASH|TELEGRAM_PHONE|TELEGRAM_BOT_TOKEN|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*\S+/gi,
      "$1=[redacted]",
    );
}

export function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return redactSecrets(err.message);
  return redactSecrets(String(err));
}
