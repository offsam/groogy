"use client";

import { useTransition, useState } from "react";
import { Heart } from "lucide-react";
import {
  addListingFavoriteAction,
  removeListingFavoriteAction,
} from "@/lib/listings/actions";
import { cn } from "@/lib/utils";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type FavoriteButtonProps = {
  listingId: string;
  initialFavorited: boolean;
  favoritesCount?: number;
  className?: string;
};

export function FavoriteButton({
  listingId,
  initialFavorited,
  favoritesCount,
  className,
}: FavoriteButtonProps) {
  const [pending, startTransition] = useTransition();
  const [favorited, setFavorited] = useState(initialFavorited);
  const [count, setCount] = useState(favoritesCount ?? 0);

  function toggle() {
    startTransition(async () => {
      const result = favorited
        ? await removeListingFavoriteAction(listingId)
        : await addListingFavoriteAction(listingId);

      if (result.ok) {
        setFavorited(!favorited);
        setCount((c) => (favorited ? Math.max(0, c - 1) : c + 1));
      }
    });
  }

  return (
    <button
      aria-label={favorited ? "Убрать из избранного" : "Добавить в избранное"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium transition-colors hover:border-slate-300 disabled:opacity-60",
        favorited && "border-rose-200 bg-rose-50 text-rose-700",
        className,
      )}
      disabled={pending}
      onClick={toggle}
      type="button"
    >
      {pending ? (
        <BrandPinLoader size="sm" />
      ) : (
        <Heart
          aria-hidden="true"
          className={cn("size-4", favorited && "fill-rose-500 text-rose-500")}
        />
      )}
      {typeof favoritesCount === "number" && <span>{count}</span>}
    </button>
  );
}
