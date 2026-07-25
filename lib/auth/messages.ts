export type AuthMessageCode =
  | "invalid_credentials"
  | "user_exists"
  | "weak_password"
  | "email_not_confirmed"
  | "email_invalid"
  | "email_rate_limit"
  | "confirmation_sent"
  | "reset_sent"
  | "oauth_not_enabled"
  | "oauth_failed"
  | "callback_failed"
  | "generic"
  | "profile_updated"
  | "password_updated";

const MESSAGES: Record<AuthMessageCode, string> = {
  invalid_credentials: "Неверный email или пароль.",
  user_exists: "Пользователь с таким email уже зарегистрирован.",
  weak_password: "Пароль слишком слабый. Используйте не менее 6 символов.",
  email_not_confirmed:
    "Подтвердите email по ссылке из письма, затем войдите снова.",
  email_invalid: "Укажите корректный адрес email.",
  email_rate_limit:
    "Слишком много попыток отправки писем. Подождите несколько минут и попробуйте снова.",
  confirmation_sent:
    "Письмо с подтверждением отправлено. Проверьте почту и перейдите по ссылке.",
  reset_sent:
    "Если аккаунт существует, мы отправили письмо для восстановления пароля.",
  oauth_not_enabled:
    "Этот способ входа ещё не настроен. Используйте email и пароль.",
  oauth_failed: "Не удалось войти через провайдера. Попробуйте позже.",
  callback_failed: "Не удалось завершить вход. Попробуйте ещё раз.",
  generic: "Произошла ошибка. Попробуйте ещё раз.",
  profile_updated: "Имя сохранено.",
  password_updated: "Пароль обновлён. Можно продолжать работу.",
};

export type AuthErrorLike = {
  message?: string;
  code?: string;
  status?: number;
  name?: string;
} | null;

export function authMessage(code: AuthMessageCode): string {
  return MESSAGES[code];
}

export function mapAuthError(error: AuthErrorLike): AuthMessageCode {
  if (!error?.message && !error?.code) return "generic";

  const message = (error.message ?? "").toLowerCase();
  const code = (error.code ?? "").toLowerCase();

  if (
    code === "invalid_credentials" ||
    message.includes("invalid login credentials") ||
    message.includes("invalid_credentials")
  ) {
    return "invalid_credentials";
  }

  if (
    code === "user_already_exists" ||
    message.includes("already registered") ||
    message.includes("user already registered") ||
    message.includes("already been registered")
  ) {
    return "user_exists";
  }

  if (
    code === "weak_password" ||
    message.includes("password should be at least") ||
    message.includes("weak password")
  ) {
    return "weak_password";
  }

  if (
    code === "email_not_confirmed" ||
    message.includes("email not confirmed")
  ) {
    return "email_not_confirmed";
  }

  if (
    code === "email_address_invalid" ||
    (message.includes("email address") && message.includes("is invalid")) ||
    message.includes("invalid email")
  ) {
    return "email_invalid";
  }

  if (
    code === "over_email_send_rate_limit" ||
    code === "email_rate_limit_exceeded" ||
    message.includes("email rate limit") ||
    message.includes("over_email_send_rate_limit")
  ) {
    return "email_rate_limit";
  }

  if (
    message.includes("provider is not enabled") ||
    message.includes("unsupported provider") ||
    (code === "validation_failed" && message.includes("provider"))
  ) {
    return "oauth_not_enabled";
  }

  return "generic";
}

/** Понятное сообщение для UI. Оригинальный текст Supabase не скрывается. */
export function formatAuthError(error: AuthErrorLike): string {
  const original = (error?.message ?? "").trim();
  const code = mapAuthError(error);

  if (!original) {
    return authMessage(code === "generic" ? "generic" : code);
  }

  // Неизвестная ошибка — показываем полный текст от Supabase.
  if (code === "generic") {
    return original;
  }

  const friendly = authMessage(code);
  if (friendly.toLowerCase() === original.toLowerCase()) {
    return friendly;
  }

  return `${friendly} (${original})`;
}

/** В development пишет детали ошибки в console. */
export function logAuthError(context: string, error: AuthErrorLike) {
  if (process.env.NODE_ENV !== "development") return;
  // eslint-disable-next-line no-console
  console.error(`[auth:${context}]`, {
    message: error?.message,
    code: error?.code,
    status: error?.status,
    error,
  });
}

export function getSiteOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;
  }
  return "http://localhost:3000";
}

export function safeRedirectPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/profile";
  }
  return value;
}
