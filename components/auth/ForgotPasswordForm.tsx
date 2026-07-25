"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { authMessage, getSiteOrigin, mapAuthError } from "@/lib/auth/messages";
import { AuthAlert, AuthField } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";

export function ForgotPasswordForm() {
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

    try {
      const supabase = createBrowserClient();
      const redirectTo = `${getSiteOrigin()}/auth/callback?next=${encodeURIComponent(
        "/auth/update-password",
      )}`;

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });

      if (resetError) {
        setError(authMessage(mapAuthError(resetError)));
        setLoading(false);
        return;
      }

      setInfo(authMessage("reset_sent"));
      setLoading(false);
    } catch {
      setError(authMessage("generic"));
      setLoading(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      {error && <AuthAlert>{error}</AuthAlert>}
      {info && <AuthAlert tone="success">{info}</AuthAlert>}

      <AuthField
        autoComplete="email"
        id="email"
        label="Email"
        name="email"
        placeholder="you@example.com"
        required
        type="email"
      />

      <Button
        className="w-full gap-2 disabled:opacity-60"
        disabled={loading}
        type="submit"
      >
        {loading && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
        Отправить ссылку
      </Button>
    </form>
  );
}
