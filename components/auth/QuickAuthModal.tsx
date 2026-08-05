"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  authMessage,
  formatAuthError,
  getSiteOrigin,
  logAuthError,
  mapAuthError,
  safeRedirectPath,
} from "@/lib/auth/messages";
import { AuthAlert, AuthField } from "@/components/auth/AuthShell";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { Button } from "@/components/ui/Button";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type QuickAuthModalProps = {
  open: boolean;
  onClose: () => void;
  /** Path to return to after auth (e.g. business page with contacts). */
  nextPath: string;
  title?: string;
  subtitle?: string;
  onAuthenticated?: () => void;
};

export function QuickAuthModal({
  open,
  onClose,
  nextPath,
  title = "Войдите, чтобы продолжить",
  subtitle = "Контакты доступны после быстрой регистрации или входа.",
  onAuthenticated,
}: QuickAuthModalProps) {
  const titleId = useId();
  const [mode, setMode] = useState<"login" | "register">("register");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      setError(null);
      setInfo(null);
      setLoading(false);
    }
  }, [open, mode]);

  if (!open) return null;

  const safeNext = safeRedirectPath(nextPath);

  async function onLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    try {
      const supabase = createBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        setError(authMessage(mapAuthError(signInError)));
        setLoading(false);
        return;
      }
      onAuthenticated?.();
      onClose();
      window.location.assign(safeNext);
    } catch {
      setError(authMessage("generic"));
      setLoading(false);
    }
  }

  async function onRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const displayName = String(form.get("display_name") ?? "").trim();
    try {
      const supabase = createBrowserClient();
      const emailRedirectTo = `${getSiteOrigin()}/auth/callback?next=${encodeURIComponent(safeNext)}`;
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo,
          data: displayName ? { display_name: displayName } : undefined,
        },
      });
      if (signUpError) {
        logAuthError("quick_register", signUpError);
        setError(formatAuthError(signUpError));
        setLoading(false);
        return;
      }
      if (data.session) {
        onAuthenticated?.();
        onClose();
        window.location.assign(safeNext);
        return;
      }
      setInfo(
        "Проверьте почту и подтвердите аккаунт — после этого контакты откроются.",
      );
      setLoading(false);
    } catch {
      setError(authMessage("generic"));
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4">
      <button
        aria-label="Закрыть"
        className="absolute inset-0 cursor-default"
        type="button"
        onClick={onClose}
      />
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative z-10 flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-xl sm:rounded-2xl"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900" id={titleId}>
              {title}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
          </div>
          <button
            aria-label="Закрыть"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            type="button"
            onClick={onClose}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4">
          <div className="mb-4 flex rounded-xl border border-slate-200 p-0.5 text-sm">
            <button
              className={`flex-1 rounded-lg px-3 py-1.5 font-medium ${
                mode === "register"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
              style={mode === "register" ? { color: "#ffffff" } : undefined}
              type="button"
              onClick={() => setMode("register")}
            >
              Регистрация
            </button>
            <button
              className={`flex-1 rounded-lg px-3 py-1.5 font-medium ${
                mode === "login"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
              style={mode === "login" ? { color: "#ffffff" } : undefined}
              type="button"
              onClick={() => setMode("login")}
            >
              Вход
            </button>
          </div>

          <OAuthButtons nextPath={safeNext} />

          <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            или email
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          {mode === "login" ? (
            <form className="space-y-3" onSubmit={onLogin}>
              {error ? <AuthAlert>{error}</AuthAlert> : null}
              <AuthField
                autoComplete="email"
                id="qa-email"
                label="Email"
                name="email"
                required
                type="email"
              />
              <AuthField
                autoComplete="current-password"
                id="qa-password"
                label="Пароль"
                minLength={6}
                name="password"
                required
                type="password"
              />
              <Button className="w-full" disabled={loading} type="submit">
                {loading ? (
                  <BrandPinLoader size="sm" />
                ) : null}
                Войти
              </Button>
            </form>
          ) : (
            <form className="space-y-3" onSubmit={onRegister}>
              {error ? <AuthAlert>{error}</AuthAlert> : null}
              {info ? (
                <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  {info}
                </p>
              ) : null}
              <AuthField
                autoComplete="name"
                id="qa-name"
                label="Имя (необязательно)"
                name="display_name"
                type="text"
              />
              <AuthField
                autoComplete="email"
                id="qa-reg-email"
                label="Email"
                name="email"
                required
                type="email"
              />
              <AuthField
                autoComplete="new-password"
                id="qa-reg-password"
                label="Пароль"
                minLength={6}
                name="password"
                required
                type="password"
              />
              <Button className="w-full" disabled={loading} type="submit">
                {loading ? (
                  <BrandPinLoader size="sm" />
                ) : null}
                Создать аккаунт
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
