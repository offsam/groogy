"use client";

import { CalendarCheck, MessageCircle } from "lucide-react";
import { LikeFollowButtons } from "@/components/engagement/LikeFollowButtons";
import { ShareEntityButton } from "@/components/engagement/ShareEntityButton";
import { cn } from "@/lib/utils";

type BusinessHeaderActionsProps = {
  businessId: string;
  businessSlug: string;
  businessName: string;
  email?: string | null;
  /** Public online booking URL (Book Now). */
  bookingUrl?: string | null;
  likesCount?: number;
  followersCount?: number;
  likedByMe?: boolean;
  followedByMe?: boolean;
  isAuthenticated?: boolean;
  className?: string;
};

export function BusinessHeaderActions({
  businessId,
  businessSlug,
  businessName,
  email = null,
  bookingUrl = null,
  likesCount = 0,
  followersCount = 0,
  likedByMe = false,
  followedByMe = false,
  isAuthenticated = false,
  className,
}: BusinessHeaderActionsProps) {
  const trimmed = email?.trim() || null;
  const bookHref = bookingUrl?.trim() || null;

  function onAsk() {
    if (trimmed) {
      const subject = encodeURIComponent(`Вопрос: ${businessName}`);
      window.location.href = `mailto:${trimmed}?subject=${subject}`;
      return;
    }
    const el = document.getElementById("business-contacts");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
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
      <LikeFollowButtons
        compact
        followersCount={followersCount}
        initialFollowed={followedByMe}
        initialLiked={likedByMe}
        isAuthenticated={isAuthenticated}
        kind="business"
        likesCount={likesCount}
        slug={businessSlug}
        targetId={businessId}
      />
      <ShareEntityButton
        title={businessName}
        url={`/business/${businessSlug}`}
      />
    </div>
  );
}
