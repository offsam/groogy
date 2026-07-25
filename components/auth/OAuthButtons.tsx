"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  authMessage,
  getSiteOrigin,
  mapAuthError,
  safeRedirectPath,
} from "@/lib/auth/messages";
import { AuthAlert } from "@/components/auth/AuthShell";
import { FacebookIcon, GoogleIcon } from "@/components/brand/BrandIcons";
import { Button } from "@/components/ui/Button";

type OAuthButtonsProps = {
  nextPath?: string;
};

export function OAuthButtons({ nextPath = "/profile" }: OAuthButtonsProps) {
  const [loading, setLoading] = useState<"google" | "facebook" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startOAuth(provider: "google" | "facebook") {
    setLoading(provider);
    setError(null);

    try {
      const supabase = createBrowserClient();
      const redirectTo = `${getSiteOrigin()}/auth/callback?next=${encodeURIComponent(
        safeRedirectPath(nextPath),
      )}`;

      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo },
      });

      if (oauthError) {
        setError(authMessage(mapAuthError(oauthError)));
        setLoading(null);
      }
    } catch {
      setError(authMessage("oauth_failed"));
      setLoading(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && <AuthAlert>{error}</AuthAlert>}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          className="w-full gap-2 disabled:opacity-60"
          disabled={loading !== null}
          onClick={() => void startOAuth("google")}
          type="button"
          variant="secondary"
        >
          {loading === "google" ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <GoogleIcon className="size-4" />
          )}
          Google
        </Button>
        <Button
          className="w-full gap-2 disabled:opacity-60"
          disabled={loading !== null}
          onClick={() => void startOAuth("facebook")}
          type="button"
          variant="secondary"
        >
          {loading === "facebook" ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <FacebookIcon className="size-4" />
          )}
          Facebook
        </Button>
      </div>
      <p className="text-center text-xs text-slate-400">
        OAuth заработает после настройки провайдеров в Supabase Dashboard.
      </p>
    </div>
  );
}
