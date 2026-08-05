"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { createBrowserClient } from "@/lib/supabase/client";
import {
  authMessage,
  mapAuthError,
  safeRedirectPath,
} from "@/lib/auth/messages";
import { AuthAlert, AuthField } from "@/components/auth/AuthShell";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { Button } from "@/components/ui/Button";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type LoginFormProps = {
  nextPath: string;
  initialError?: string | null;
};

export function LoginForm({ nextPath, initialError }: LoginFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
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

      router.replace(safeRedirectPath(nextPath));
      router.refresh();
    } catch {
      setError(authMessage("generic"));
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <form className="space-y-4" onSubmit={onSubmit}>
        {error && <AuthAlert>{error}</AuthAlert>}

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
          autoComplete="current-password"
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
          {loading && <BrandPinLoader size="sm" />}
          Войти
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
