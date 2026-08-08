"use client";

import Image from "next/image";
import Link from "next/link";
import { MapPin, Star } from "lucide-react";
import { BusinessCardContactIcons } from "@/components/business/BusinessCardContactIcons";
import { CommunityRecommendationBadge } from "@/components/shared/CommunityRecommendationCount";
import { PaymentMethodIcons } from "@/components/shared/PaymentMethodIcons";
import { businessCardBlurb } from "@/lib/business/card-blurb";
import { normalizeUsZip } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { isPlaceholderBusinessImage } from "@/lib/business/media";
import { trackResourceOpen } from "@/lib/platform/engagement";
import { ReportEntityButton } from "@/components/support/ReportEntityButton";
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
    // Admin preview on phone: stack so the card fits the viewport width
    preview &&
      "max-sm:w-full max-sm:max-w-full max-sm:min-w-0 max-sm:flex-col max-sm:gap-2 max-sm:overflow-hidden",
    !preview && "cursor-pointer",
    selected
      ? "border-slate-900 shadow-md ring-1 ring-slate-900"
      : "border-slate-200 hover:border-slate-300 hover:shadow-sm",
  );

  const body = (
    <>
      <div
        className={cn(
          "relative size-20 shrink-0 overflow-hidden rounded-lg bg-slate-100 sm:size-28",
          preview &&
            "max-sm:aspect-[16/10] max-sm:h-auto max-sm:w-full max-sm:max-w-none",
        )}
      >
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

      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex items-start justify-between gap-2">
          <h3
            className={cn(
              "font-semibold text-slate-900",
              preview ? "max-sm:line-clamp-2 sm:truncate" : "truncate",
            )}
          >
            {business.name}
          </h3>
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

        {(business.thirdPartyMentionCount ?? 0) > 0 ? (
          <div className="mt-1.5">
            <CommunityRecommendationBadge
              compact
              count={Number(business.thirdPartyMentionCount)}
            />
          </div>
        ) : null}

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
          className={preview ? "max-sm:mt-2" : undefined}
          flags={business.presenceFlags}
          googleRating={business.googleRating}
          googleReviewsCount={business.googleReviewsCount}
          instagramFollowersCount={business.instagramFollowersCount}
          slug={business.slug}
          trustpilotRating={business.trustpilotRating}
          trustpilotReviewsCount={business.trustpilotReviewsCount}
          facebookRecommendPct={business.facebookRecommendPct}
          facebookReviewsCount={business.facebookReviewsCount}
          yelpRating={business.yelpRating}
          yelpReviewsCount={business.yelpReviewsCount}
        />
        {business.paymentMethods?.length ? (
          <PaymentMethodIcons
            className="mt-2 w-full justify-end"
            methods={business.paymentMethods}
            size="sm"
          />
        ) : null}
      </div>
    </>
  );

  if (preview) {
    return <article className={className}>{body}</article>;
  }

  return (
    <div className="relative">
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
      <ReportEntityButton
        className="absolute right-2 top-2"
        entityId={business.id}
        entityName={business.name}
        entityType="business"
      />
    </div>
  );
}
