"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Bell, BellOff } from "lucide-react";
import {
  followEntityAction,
  unfollowEntityAction,
} from "@/lib/updates/actions";
import type { UpdateOwnerType } from "@/types/update";
import { cn } from "@/lib/utils";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type FollowEntityButtonProps = {
  ownerType: UpdateOwnerType;
  ownerId: string;
  initialFollowing: boolean;
  isAuthenticated: boolean;
  revalidatePath?: string;
  className?: string;
};

export function FollowEntityButton({
  ownerType,
  ownerId,
  initialFollowing,
  isAuthenticated,
  revalidatePath,
  className,
}: FollowEntityButtonProps) {
  const [pending, startTransition] = useTransition();
  const [following, setFollowing] = useState(initialFollowing);

  if (!isAuthenticated) {
    const next =
      revalidatePath ||
      (ownerType === "business"
        ? `/business`
        : `/professional`);
    return (
      <Link
        href={`/login?next=${encodeURIComponent(revalidatePath || next)}`}
        className={cn(
          "inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-brand-blue/40",
          className,
        )}
      >
        <Bell aria-hidden="true" className="size-4 text-brand-blue" />
        Добавить в круги
      </Link>
    );
  }

  function toggle() {
    startTransition(async () => {
      const result = following
        ? await unfollowEntityAction({
            ownerType,
            ownerId,
            revalidate: revalidatePath,
          })
        : await followEntityAction({
            ownerType,
            ownerId,
            revalidate: revalidatePath,
          });
      if (result.ok) setFollowing(!following);
    });
  }

  return (
    <button
      aria-label={following ? "Убрать из кругов" : "Добавить в круги"}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60",
        following
          ? "border-brand-blue/30 bg-sky-50 text-brand-blue"
          : "border-slate-200 bg-white text-slate-700 hover:border-brand-blue/40",
        className,
      )}
      disabled={pending}
      onClick={toggle}
      type="button"
    >
      {pending ? (
        <BrandPinLoader size="sm" />
      ) : following ? (
        <BellOff aria-hidden="true" className="size-4" />
      ) : (
        <Bell aria-hidden="true" className="size-4 text-brand-blue" />
      )}
      {following ? "В кругах" : "Добавить в круги"}
    </button>
  );
}
