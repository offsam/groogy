"use client";

import { useState, type MouseEvent } from "react";
import { Check, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ShareEntityButtonProps = {
  /** Share title (entity name). */
  title: string;
  /** Absolute or site-relative path. Defaults to current page URL. */
  url?: string | null;
  /** Optional share text / description. */
  text?: string | null;
  /** Icon-only (default) or labeled button. */
  variant?: "icon" | "button";
  className?: string;
  /** Stop click from bubbling (needed inside Link cards). */
  stopPropagation?: boolean;
};

function resolveShareUrl(url?: string | null): string {
  if (typeof window === "undefined") return url?.trim() || "";
  const raw = url?.trim();
  if (!raw) return window.location.href;
  if (/^https?:\/\//i.test(raw)) return raw;
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return `${window.location.origin}${path}`;
}

export async function shareEntity(input: {
  title: string;
  url?: string | null;
  text?: string | null;
}): Promise<"shared" | "copied" | "cancelled"> {
  const shareUrl = resolveShareUrl(input.url);
  const title = input.title.trim() || "КРУГИ";
  const text = input.text?.trim() || undefined;

  try {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      await navigator.share({ title, text, url: shareUrl });
      return "shared";
    }
  } catch (err) {
    // User cancelled the system sheet — not an error.
    if (err instanceof DOMException && err.name === "AbortError") {
      return "cancelled";
    }
  }

  try {
    await navigator.clipboard.writeText(shareUrl);
    return "copied";
  } catch {
    return "cancelled";
  }
}

const iconBtn =
  "inline-flex size-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 sm:size-8 sm:rounded-lg";

export function ShareEntityButton({
  title,
  url = null,
  text = null,
  variant = "icon",
  className,
  stopPropagation = false,
}: ShareEntityButtonProps) {
  const [copied, setCopied] = useState(false);

  async function onShare(e: MouseEvent) {
    if (stopPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    const result = await shareEntity({ title, url, text });
    if (result === "copied") {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }

  if (variant === "button") {
    return (
      <button
        aria-label={copied ? "Ссылка скопирована" : "Поделиться"}
        className={cn(
          "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 sm:min-h-0 sm:py-1.5",
          className,
        )}
        title={copied ? "Скопировано" : "Поделиться"}
        type="button"
        onClick={(e) => void onShare(e)}
      >
        {copied ? (
          <Check aria-hidden="true" className="size-3.5 text-brand-green" />
        ) : (
          <Share2 aria-hidden="true" className="size-3.5 text-slate-500" />
        )}
        {copied ? "Скопировано" : "Поделиться"}
      </button>
    );
  }

  return (
    <button
      aria-label={copied ? "Ссылка скопирована" : "Поделиться"}
      className={cn(iconBtn, className)}
      title={copied ? "Скопировано" : "Поделиться"}
      type="button"
      onClick={(e) => void onShare(e)}
    >
      {copied ? (
        <Check aria-hidden="true" className="size-3.5 text-brand-green" />
      ) : (
        <Share2 aria-hidden="true" className="size-3.5" />
      )}
    </button>
  );
}
