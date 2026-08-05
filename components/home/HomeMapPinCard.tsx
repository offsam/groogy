"use client";

import Image from "next/image";
import Link from "next/link";
import { MapPin, Star, X } from "lucide-react";
import { BusinessCardContactIcons } from "@/components/business/BusinessCardContactIcons";
import { businessCardBlurb } from "@/lib/business/card-blurb";
import { normalizeUsZip } from "@/lib/brand";
import { isPlaceholderBusinessImage } from "@/lib/business/media";
import { trackResourceOpen } from "@/lib/platform/engagement";
import type { HomeMapPin } from "@/lib/supabase/queries";
import { cn } from "@/lib/utils";

type HomeMapPinCardProps = {
  pin: HomeMapPin;
  onClose?: () => void;
  className?: string;
};

function pinLocationLabel(pin: HomeMapPin): string | null {
  const city = pin.city?.trim() || "";
  const zip = pin.postalCode ? normalizeUsZip(pin.postalCode) : null;
  if (city && zip) return `${city}, ${zip}`;
  if (city) return city;
  if (zip) return zip;
  return null;
}

/** Same layout language as BusinessCard listing preview (incl. Google / Yelp chips). */
export function HomeMapPinCard({
  pin,
  onClose,
  className,
}: HomeMapPinCardProps) {
  const locationLabel = pinLocationLabel(pin);
  const blurb = businessCardBlurb({
    shortDescription: pin.shortDescription,
    description: pin.description,
    categoryName: pin.categoryName,
  });
  const isPlaceholder = isPlaceholderBusinessImage(pin.imageUrl);
  const kindLabel =
    pin.kind === "professional"
      ? "Специалист"
      : pin.kind === "church"
        ? "Церковь"
        : "Бизнес";

  return (
    <div
      className={cn(
        "relative w-[min(100vw-1.5rem,22rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_14px_36px_rgba(15,23,42,0.2)]",
        className,
      )}
    >
      {onClose ? (
        <button
          aria-label="Закрыть"
          className="absolute right-2 top-2 z-10 inline-flex size-7 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-500 transition hover:text-slate-800"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          type="button"
        >
          <X aria-hidden className="size-3.5" strokeWidth={2.5} />
        </button>
      ) : null}

      <Link
        className="flex gap-3 p-3 pr-10 transition hover:bg-slate-50/70"
        href={pin.href}
        onClick={() => {
          if (pin.kind === "business") {
            trackResourceOpen({
              kind: "business",
              id: pin.id,
              pathId: pin.slug,
              path: pin.href,
            });
          }
        }}
      >
        <div className="relative size-20 shrink-0 overflow-hidden rounded-lg bg-slate-100">
          {isPlaceholder || !pin.imageUrl ? (
            <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900 px-1.5 text-center text-[10px] font-semibold uppercase leading-tight tracking-wide text-white">
              {pin.categoryName ?? kindLabel}
            </div>
          ) : (
            <Image
              alt={pin.name}
              className="object-cover"
              fill
              sizes="80px"
              src={pin.imageUrl}
              unoptimized
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate font-semibold text-slate-900">{pin.name}</h3>
            {pin.reviewsCount > 0 ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-sm font-semibold text-amber-700">
                <Star
                  aria-hidden
                  className="size-3.5 fill-amber-500 text-amber-500"
                />
                {pin.ratingAvg.toFixed(1)}
              </span>
            ) : null}
          </div>

          <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-slate-400">
            {pin.categoryName ?? kindLabel}
            {pin.reviewsCount > 0 ? ` · ${pin.reviewsCount} отзывов` : null}
          </p>

          {blurb ? (
            <p className="mt-1.5 line-clamp-2 text-sm text-slate-600">{blurb}</p>
          ) : null}

          {locationLabel ? (
            <p className="mt-2 flex min-w-0 items-center gap-1.5 text-sm text-slate-600">
              <MapPin
                aria-hidden
                className="size-3.5 shrink-0 text-slate-400"
              />
              <span className="truncate">{locationLabel}</span>
            </p>
          ) : null}

          <BusinessCardContactIcons
            flags={pin.presenceFlags}
            googleRating={pin.googleRating}
            googleReviewsCount={pin.googleReviewsCount}
            instagramFollowersCount={pin.instagramFollowersCount}
            maxVisible={6}
            slug={pin.slug}
            trustpilotRating={pin.trustpilotRating}
            trustpilotReviewsCount={pin.trustpilotReviewsCount}
            yelpRating={pin.yelpRating}
            yelpReviewsCount={pin.yelpReviewsCount}
          />
        </div>
      </Link>
    </div>
  );
}
