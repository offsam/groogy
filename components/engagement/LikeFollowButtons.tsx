"use client";

import { useState, useTransition } from "react";
import { Bookmark, Heart, Loader2 } from "lucide-react";
import {
  followBusinessAction,
  followProfessionalAction,
  likeBusinessAction,
  likeProfessionalAction,
  unfollowBusinessAction,
  unfollowProfessionalAction,
  unlikeBusinessAction,
  unlikeProfessionalAction,
} from "@/lib/engagement/actions";
import { cn } from "@/lib/utils";

type TargetKind = "business" | "professional";

type LikeFollowButtonsProps = {
  kind: TargetKind;
  targetId: string;
  slug: string;
  initialLiked: boolean;
  initialFollowed: boolean;
  likesCount: number;
  followersCount: number;
  /** When false, buttons still show counts but prompt login via link. */
  isAuthenticated: boolean;
  className?: string;
  compact?: boolean;
};

const iconBtn =
  "inline-flex size-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-60 sm:size-8 sm:rounded-lg";

export function LikeFollowButtons({
  kind,
  targetId,
  slug,
  initialLiked,
  initialFollowed,
  likesCount,
  followersCount,
  isAuthenticated,
  className,
  compact = false,
}: LikeFollowButtonsProps) {
  const [pending, startTransition] = useTransition();
  const [liked, setLiked] = useState(initialLiked);
  const [followed, setFollowed] = useState(initialFollowed);
  const [likes, setLikes] = useState(likesCount);
  const [followers, setFollowers] = useState(followersCount);

  function toggleLike() {
    if (!isAuthenticated) {
          window.location.href = `/login?next=${encodeURIComponent(
        kind === "business" ? `/business/${slug}` : `/professional/${slug}`,
      )}`;
      return;
    }
    startTransition(async () => {
      const result =
        kind === "business"
          ? liked
            ? await unlikeBusinessAction(targetId, slug)
            : await likeBusinessAction(targetId, slug)
          : liked
            ? await unlikeProfessionalAction(targetId, slug)
            : await likeProfessionalAction(targetId, slug);
      if (result.ok) {
        setLiked(!liked);
        setLikes((c) => (liked ? Math.max(0, c - 1) : c + 1));
      }
    });
  }

  function toggleFollow() {
    if (!isAuthenticated) {
          window.location.href = `/login?next=${encodeURIComponent(
        kind === "business" ? `/business/${slug}` : `/professional/${slug}`,
      )}`;
      return;
    }
    startTransition(async () => {
      const result =
        kind === "business"
          ? followed
            ? await unfollowBusinessAction(targetId, slug)
            : await followBusinessAction(targetId, slug)
          : followed
            ? await unfollowProfessionalAction(targetId, slug)
            : await followProfessionalAction(targetId, slug);
      if (result.ok) {
        setFollowed(!followed);
        setFollowers((c) => (followed ? Math.max(0, c - 1) : c + 1));
      }
    });
  }

  if (compact) {
    return (
      <div className={cn("flex items-center gap-1.5", className)}>
        <button
          aria-label={liked ? "Убрать лайк" : "Лайк"}
          className={cn(
            iconBtn,
            liked && "border-rose-200 bg-rose-50 text-rose-700",
          )}
          disabled={pending}
          onClick={toggleLike}
          title={liked ? "Убрать лайк" : "Лайк"}
          type="button"
        >
          {pending ? (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          ) : (
            <Heart
              aria-hidden="true"
              className={cn("size-3.5", liked && "fill-rose-500 text-rose-500")}
            />
          )}
        </button>
        <button
          aria-label={followed ? "Отписаться" : "Подписаться"}
          className={cn(
            iconBtn,
            followed && "border-brand-blue/30 bg-brand-blue/5 text-brand-blue",
          )}
          disabled={pending}
          onClick={toggleFollow}
          title={followed ? "Отписаться" : "Подписаться"}
          type="button"
        >
          <Bookmark
            aria-hidden="true"
            className={cn(
              "size-3.5",
              followed && "fill-brand-blue text-brand-blue",
            )}
          />
        </button>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <button
        aria-label={liked ? "Убрать лайк" : "Лайк"}
        className={cn(
          "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-60 sm:min-h-0 sm:py-1.5",
          liked && "border-rose-200 bg-rose-50 text-rose-700",
        )}
        disabled={pending}
        onClick={toggleLike}
        type="button"
      >
        {pending ? (
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
        ) : (
          <Heart
            aria-hidden="true"
            className={cn("size-3.5", liked && "fill-rose-500 text-rose-500")}
          />
        )}
        <span>{likes}</span>
        <span className="sr-only sm:not-sr-only sm:inline">Лайк</span>
      </button>
      <button
        aria-label={followed ? "Отписаться" : "Подписаться"}
        className={cn(
          "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-60 sm:min-h-0 sm:py-1.5",
          followed && "border-brand-blue/30 bg-brand-blue/5 text-brand-blue",
        )}
        disabled={pending}
        onClick={toggleFollow}
        type="button"
      >
        <Bookmark
          aria-hidden="true"
          className={cn(
            "size-3.5",
            followed && "fill-brand-blue text-brand-blue",
          )}
        />
        <span>{followers}</span>
        <span className="sr-only sm:not-sr-only sm:inline">
          {followed ? "Вы подписаны" : "Подписаться"}
        </span>
      </button>
    </div>
  );
}
