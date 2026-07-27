"use client";

import { useState } from "react";
import { Bookmark, CalendarCheck, MessageCircle, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";

type BusinessHeaderActionsProps = {
  businessName: string;
  email?: string | null;
  /** Public online booking URL (Book Now). */
  bookingUrl?: string | null;
  className?: string;
};

const iconBtn =
  "inline-flex size-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 sm:size-8 sm:rounded-lg";

export function BusinessHeaderActions({
  businessName,
  email = null,
  bookingUrl = null,
  className,
}: BusinessHeaderActionsProps) {
  const trimmed = email?.trim() || null;
  const bookHref = bookingUrl?.trim() || null;
  const [copied, setCopied] = useState(false);

  function onAsk() {
    if (trimmed) {
      const subject = encodeURIComponent(`Вопрос: ${businessName}`);
      window.location.href = `mailto:${trimmed}?subject=${subject}`;
      return;
    }
    const el = document.getElementById("business-contacts");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function onShare() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.share) {
        await navigator.share({ title: businessName, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* cancelled */
    }
  }

  return (
    <div
      className={cn(
        "flex shrink-0 flex-row flex-wrap items-center gap-2 sm:flex-col sm:items-end sm:gap-1.5",
        className,
      )}
    >
      {bookHref ? (
        <a
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-blue px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-blue/90 sm:min-h-0 sm:flex-none sm:py-1.5"
          href={bookHref}
          rel="noopener noreferrer"
          target="_blank"
        >
          <CalendarCheck aria-hidden="true" className="size-3.5" />
          Записаться
        </a>
      ) : null}
      <button
        className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 sm:min-h-0 sm:flex-none sm:py-1.5"
        type="button"
        onClick={onAsk}
      >
        <MessageCircle aria-hidden="true" className="size-3.5 text-slate-500" />
        Задать вопрос
      </button>
      <div className="flex items-center gap-1.5">
        <button
          aria-label={copied ? "Ссылка скопирована" : "Поделиться"}
          className={iconBtn}
          title={copied ? "Скопировано" : "Поделиться"}
          type="button"
          onClick={() => void onShare()}
        >
          <Share2 aria-hidden="true" className="size-3.5" />
        </button>
        <button
          aria-disabled="true"
          aria-label="Сохранить"
          className={cn(iconBtn, "cursor-default text-slate-400")}
          title="Скоро"
          type="button"
        >
          <Bookmark aria-hidden="true" className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
