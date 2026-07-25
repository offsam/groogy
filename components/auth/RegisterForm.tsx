"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  authMessage,
  formatAuthError,
  getSiteOrigin,
  logAuthError,
  safeRedirectPath,
} from "@/lib/auth/messages";
import { AuthAlert, AuthField } from "@/components/auth/AuthShell";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { Button } from "@/components/ui/Button";

type RegisterFormProps = {
  nextPath: string;
};

export function RegisterForm({ nextPath }: RegisterFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
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
      const emailRedirectTo = `${getSiteOrigin()}/auth/callback?next=${encodeURIComponent(
        safeRedirectPath(nextPath),
      )}`;

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo,
          data: {
            full_name: displayName || undefined,
            name: displayName || undefined,
          },
        },
      });

      if (signUpError) {
        logAuthError("register", signUpError);
        setError(formatAuthError(signUpError));
        setLoading(false);
        return;
      }

      // If email confirmation is enabled, session may be null until the link is clicked.
      if (!data.session) {
        setInfo(authMessage("confirmation_sent"));
        setLoading(false);
        return;
      }

      router.replace(safeRedirectPath(nextPath));
      router.refresh();
    } catch (err) {
      const unknownError =
        err && typeof err === "object"
          ? (err as { message?: string; code?: string; status?: number })
          : { message: err instanceof Error ? err.message : String(err) };
      logAuthError("register", unknownError);
      setError(formatAuthError(unknownError));
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <form className="space-y-4" onSubmit={onSubmit}>
        {error && <AuthAlert>{error}</AuthAlert>}
        {info && <AuthAlert tone="success">{info}</AuthAlert>}

        <AuthField
          autoComplete="name"
          id="display_name"
          label="Имя"
          name="display_name"
          placeholder="Как к вам обращаться"
          type="text"
        />
        <AuthField
          autoComplete="email"
          id="email"
          label="Email"
          name="email"
          placeholder="you@example.com"
          required
          type="email"
        />
        <AuthField
          autoComplete="new-password"
          id="password"
          label="Пароль"
          minLength={6}
          name="password"
          required
          type="password"
        />

        <Button
          className="w-full gap-2 disabled:opacity-60"
          disabled={loading}
          type="submit"
        >
          {loading && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          Зарегистрироваться
        </Button>
      </form>

      <div className="relative text-center text-xs uppercase tracking-wide text-slate-400">
        <span className="relative z-10 bg-white px-2">или</span>
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-100" />
      </div>

      <OAuthButtons nextPath={nextPath} />
    </div>
  );
}
