"use client";

import { useState, useTransition } from "react";
import { Bookmark, Heart, Loader2, ThumbsDown } from "lucide-react";
import {
  dislikeBusinessAction,
  dislikeProfessionalAction,
  followBusinessAction,
  followProfessionalAction,
  likeBusinessAction,
  likeProfessionalAction,
  undislikeBusinessAction,
  undislikeProfessionalAction,
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
  initialDisliked: boolean;
  initialFollowed: boolean;
  likesCount: number;
  dislikesCount: number;
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
  initialDisliked,
  initialFollowed,
  likesCount,
  dislikesCount,
  followersCount,
  isAuthenticated,
  className,
  compact = false,
}: LikeFollowButtonsProps) {
  const [pending, startTransition] = useTransition();
  const [liked, setLiked] = useState(initialLiked);
  const [disliked, setDisliked] = useState(initialDisliked);
  const [followed, setFollowed] = useState(initialFollowed);
  const [likes, setLikes] = useState(likesCount);
  const [dislikes, setDislikes] = useState(dislikesCount);
  const [followers, setFollowers] = useState(followersCount);

  function loginRedirect() {
    window.location.href = `/login?next=${encodeURIComponent(
      kind === "business" ? `/business/${slug}` : `/professional/${slug}`,
    )}`;
  }

  function toggleLike() {
    if (!isAuthenticated) {
      loginRedirect();
      return;
    }
    startTransition(async () => {
      if (liked) {
        const result =
          kind === "business"
            ? await unlikeBusinessAction(targetId, slug)
            : await unlikeProfessionalAction(targetId, slug);
        if (result.ok) {
          setLiked(false);
          setLikes((c) => Math.max(0, c - 1));
        }
        return;
      }

      const result =
        kind === "business"
          ? await likeBusinessAction(targetId, slug)
          : await likeProfessionalAction(targetId, slug);
      if (result.ok) {
        setLiked(true);
        setLikes((c) => c + 1);
        if (disliked || result.clearedOpposite) {
          setDisliked(false);
          setDislikes((c) => Math.max(0, c - (disliked ? 1 : 0)));
        }
      }
    });
  }

  function toggleDislike() {
    if (!isAuthenticated) {
      loginRedirect();
      return;
    }
    startTransition(async () => {
      if (disliked) {
        const result =
          kind === "business"
            ? await undislikeBusinessAction(targetId, slug)
            : await undislikeProfessionalAction(targetId, slug);
        if (result.ok) {
          setDisliked(false);
          setDislikes((c) => Math.max(0, c - 1));
        }
        return;
      }

      const result =
        kind === "business"
          ? await dislikeBusinessAction(targetId, slug)
          : await dislikeProfessionalAction(targetId, slug);
      if (result.ok) {
        setDisliked(true);
        setDislikes((c) => c + 1);
        if (liked || result.clearedOpposite) {
          setLiked(false);
          setLikes((c) => Math.max(0, c - (liked ? 1 : 0)));
        }
      }
    });
  }

  function toggleFollow() {
    if (!isAuthenticated) {
      loginRedirect();
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
          aria-label={disliked ? "Убрать дизлайк" : "Дизлайк"}
          className={cn(
            iconBtn,
            disliked && "border-slate-300 bg-slate-100 text-slate-800",
          )}
          disabled={pending}
          onClick={toggleDislike}
          title={disliked ? "Убрать дизлайк" : "Дизлайк"}
          type="button"
        >
          <ThumbsDown
            aria-hidden="true"
            className={cn("size-3.5", disliked && "fill-slate-700 text-slate-800")}
          />
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
        aria-label={disliked ? "Убрать дизлайк" : "Дизлайк"}
        className={cn(
          "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-60 sm:min-h-0 sm:py-1.5",
          disliked && "border-slate-300 bg-slate-100 text-slate-800",
        )}
        disabled={pending}
        onClick={toggleDislike}
        type="button"
      >
        <ThumbsDown
          aria-hidden="true"
          className={cn("size-3.5", disliked && "fill-slate-700 text-slate-800")}
        />
        <span>{dislikes}</span>
        <span className="sr-only sm:not-sr-only sm:inline">Дизлайк</span>
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
