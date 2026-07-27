"use client";

import Image from "next/image";
import Link from "next/link";
import { MapPin, Star } from "lucide-react";
import { BusinessCardContactIcons } from "@/components/business/BusinessCardContactIcons";
import { businessCardBlurb } from "@/lib/business/card-blurb";
import { normalizeUsZip } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { isPlaceholderBusinessImage } from "@/lib/business/media";
import { trackResourceOpen } from "@/lib/platform/engagement";
import type { Business } from "@/types/business";

type BusinessCardProps = {
  business: Business;
  selected?: boolean;
  onSelect?: (id: string) => void;
  /** Admin moderation: no public links or analytics. */
  preview?: boolean;
};

/** Listing location line: «Irvine, 92612» (city + ZIP only, no street). */
export function businessCardLocationLabel(business: Business): string | null {
  const city = business.city?.trim() || "";
  const zip = business.postalCode
    ? normalizeUsZip(business.postalCode)
    : null;
  if (city && zip) return `${city}, ${zip}`;
  if (city) return city;
  if (zip) return zip;
  return null;
}

export function BusinessCard({
  business,
  selected = false,
  onSelect,
  preview = false,
}: BusinessCardProps) {
  const locationLabel = businessCardLocationLabel(business);
  const blurb = businessCardBlurb({
    shortDescription: business.shortDescription,
    description: business.description,
    categoryName: business.categoryName,
  });
  const isPlaceholder = isPlaceholderBusinessImage(business.imageUrl);

  const className = cn(
    "flex gap-3 rounded-xl border bg-white p-3 transition-all sm:gap-4 sm:p-4",
    !preview && "cursor-pointer",
    selected
      ? "border-slate-900 shadow-md ring-1 ring-slate-900"
      : "border-slate-200 hover:border-slate-300 hover:shadow-sm",
  );

  const body = (
    <>
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

        <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-slate-400">
          {business.categoryName ?? "Без категории"}
          {business.reviewsCount > 0 && ` · ${business.reviewsCount} отзывов`}
        </p>

        {blurb ? (
          <p className="mt-1.5 line-clamp-2 text-sm text-slate-600">{blurb}</p>
        ) : null}

        {locationLabel ? (
          <p className="mt-2 flex min-w-0 items-center gap-1.5 text-sm text-slate-600">
            <MapPin aria-hidden="true" className="size-3.5 shrink-0 text-slate-400" />
            <span className="truncate">{locationLabel}</span>
          </p>
        ) : null}

        <BusinessCardContactIcons
          flags={business.presenceFlags}
          googleRating={business.googleRating}
          googleReviewsCount={business.googleReviewsCount}
          instagramFollowersCount={business.instagramFollowersCount}
          slug={business.slug}
          yelpRating={business.yelpRating}
          yelpReviewsCount={business.yelpReviewsCount}
        />
      </div>
    </>
  );

  if (preview) {
    return <article className={className}>{body}</article>;
  }

  return (
    <Link
      className={className}
      href={`/business/${business.slug}`}
      onClick={() => {
        trackResourceOpen({
          kind: "business",
          id: business.id,
          pathId: business.slug,
        });
        onSelect?.(business.id);
      }}
    >
      {body}
    </Link>
  );
}
