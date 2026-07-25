"use client";

import Image from "next/image";
import Link from "next/link";
import { MapPin, Star } from "lucide-react";
import { BusinessPresenceBadges } from "@/components/business/BusinessPresenceBadges";
import { ClaimBusinessButton } from "@/components/business/ClaimBusinessButton";
import { cn } from "@/lib/utils";
import { isPlaceholderBusinessImage } from "@/lib/business/media";
import { trackResourceOpen } from "@/lib/platform/engagement";
import type { Business } from "@/types/business";

type BusinessCardProps = {
  business: Business;
  selected?: boolean;
  onSelect?: (id: string) => void;
};

export function BusinessCard({ business, selected = false, onSelect }: BusinessCardProps) {
  const city = business.city?.trim() || "";
  const isPlaceholder = isPlaceholderBusinessImage(business.imageUrl);

  return (
    <article
      className={cn(
        "flex gap-3 rounded-xl border bg-white p-3 transition-all sm:gap-4 sm:p-4",
        onSelect && "cursor-pointer",
        selected
          ? "border-slate-900 shadow-md ring-1 ring-slate-900"
          : "border-slate-200 hover:border-slate-300 hover:shadow-sm",
      )}
      onClick={
        onSelect
          ? () => {
              trackResourceOpen({
                kind: "business",
                id: business.id,
                pathId: business.slug,
              });
              onSelect(business.id);
            }
          : undefined
      }
    >
      <div className="relative size-20 shrink-0 overflow-hidden rounded-lg bg-slate-100 sm:size-28">
        {isPlaceholder ? (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900 px-2 text-center text-[10px] font-semibold uppercase leading-tight tracking-wide text-white">
            {business.categoryName ?? "Бизнес"}
          </div>
        ) : (
          <Image
            alt={business.name}
            className="object-cover"
            fill
            sizes="112px"
            src={business.imageUrl!}
            unoptimized
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate font-semibold text-slate-900">{business.name}</h3>
          {business.reviewsCount > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-sm font-semibold text-amber-700">
              <Star aria-hidden="true" className="size-3.5 fill-amber-500 text-amber-500" />
              {business.ratingAvg.toFixed(1)}
            </span>
          )}
        </div>

        <BusinessPresenceBadges
          presence={{
            website: business.website,
            instagramUrl: business.instagramUrl,
            googleMapsUrl: business.googleMapsUrl,
            googleRating: business.googleRating,
            googleReviewsCount: business.googleReviewsCount,
            latitude: business.latitude,
            longitude: business.longitude,
          }}
        />

        <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-slate-400">
          {business.categoryName ?? "Без категории"}
          {business.reviewsCount > 0 && ` · ${business.reviewsCount} отзывов`}
        </p>

        {city ? (
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            <li className="flex items-center gap-1.5 truncate">
              <MapPin aria-hidden="true" className="size-3.5 shrink-0 text-slate-400" />
              {city}
            </li>
          </ul>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link
            className="inline-block rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-900 hover:text-white"
            href={`/business/${business.slug}`}
            onClick={(e) => {
              e.stopPropagation();
              trackResourceOpen({
                kind: "business",
                id: business.id,
                pathId: business.slug,
              });
            }}
          >
            Подробнее
          </Link>
          <ClaimBusinessButton
            businessId={business.id}
            businessSlug={business.slug}
            kind="business"
          />
        </div>
      </div>
    </article>
  );
}
