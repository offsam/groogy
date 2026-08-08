"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, MapPin, Plane } from "lucide-react";
import {
  CategoryAccentBar,
  CategoryChip,
  CategoryMediaFallback,
} from "@/components/platform/CategoryCardChrome";
import { FavoriteButton } from "@/components/marketplace/FavoriteButton";
import { ReportEntityButton } from "@/components/support/ReportEntityButton";
import { PaymentMethodIcons } from "@/components/shared/PaymentMethodIcons";
import type { Listing } from "@/types/listing";
import {
  LECHU_CARRY_TYPE_LABELS,
  LECHU_REWARD_LABELS,
  LISTING_STATUS_LABELS,
} from "@/types/listing";
import { trackResourceOpen } from "@/lib/platform/engagement";

type LechuCardProps = {
  listing: Listing;
  showFavorite?: boolean;
  showStatus?: boolean;
  preview?: boolean;
};

function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function MaybeLink({
  preview,
  href,
  className,
  onClick,
  children,
}: {
  preview: boolean;
  href: string;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  if (preview) return <div className={className}>{children}</div>;
  return (
    <Link className={className} href={href} onClick={onClick}>
      {children}
    </Link>
  );
}

function RouteLine({
  from,
  to,
  className = "",
}: {
  from: string;
  to: string;
  className?: string;
}) {
  return (
    <p
      className={`flex flex-wrap items-center justify-center gap-1.5 text-center text-sm font-semibold text-teal-900 ${className}`}
    >
      <span className="line-clamp-1 max-w-[40%]">{from}</span>
      <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 text-teal-600" />
      <span className="line-clamp-1 max-w-[40%]">{to}</span>
    </p>
  );
}

export function LechuCard({
  listing,
  showFavorite = false,
  showStatus = false,
  preview = false,
}: LechuCardProps) {
  const cover = listing.media?.[0]?.publicUrl;
  const lechu = listing.lechu;
  const dateLabel = formatDate(listing.publishedAt ?? listing.createdAt);
  const departureLabel = formatDate(lechu?.departureDate ?? null);
  const location = [listing.city, listing.state].filter(Boolean).join(", ");
  const publisherLabel =
    listing.publisher?.name ?? listing.author?.label ?? null;
  const publisherHref =
    listing.publisher?.publisherType === "business" && listing.publisher.slug
      ? `/business/${listing.publisher.slug}`
      : listing.author?.profilePath;
  const carryPreview = (lechu?.carryTypes ?? [])
    .slice(0, 2)
    .map(
      (t) =>
        LECHU_CARRY_TYPE_LABELS[t as keyof typeof LECHU_CARRY_TYPE_LABELS] ?? t,
    );
  const href = `/lechu/${listing.id}`;
  const hasRoute = Boolean(lechu?.departureCountry && lechu?.destinationCountry);

  return (
    <article className="group overflow-hidden rounded-2xl border border-slate-200 bg-white transition-shadow hover:shadow-md">
      <CategoryAccentBar theme="lechu" />
      <MaybeLink
        className="block"
        href={href}
        preview={preview}
        onClick={() => trackResourceOpen({ kind: "lechu", id: listing.id })}
      >
        <div className="relative aspect-[4/3] bg-slate-100">
          {cover ? (
            <Image
              alt={listing.title}
              className="object-cover transition-transform group-hover:scale-[1.02]"
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              src={cover}
              unoptimized
            />
          ) : (
            <CategoryMediaFallback icon={Plane} theme="lechu">
              {hasRoute ? (
                <RouteLine
                  from={lechu!.departureCountry}
                  to={lechu!.destinationCountry}
                  className="mt-1 px-1"
                />
              ) : null}
            </CategoryMediaFallback>
          )}
        </div>
      </MaybeLink>

      <div className="space-y-2 p-4">
        <CategoryChip theme="lechu" />

        <div className="flex items-start justify-between gap-2">
          <MaybeLink
            className="line-clamp-2 font-semibold text-slate-900 hover:underline"
            href={href}
            preview={preview}
            onClick={() => trackResourceOpen({ kind: "lechu", id: listing.id })}
          >
            {listing.title}
          </MaybeLink>
          {!preview ? (
            <div className="flex shrink-0 items-center gap-1.5">
              {showFavorite ? (
                <FavoriteButton
                  favoritesCount={listing.favoritesCount}
                  initialFavorited={listing.favoritedByMe ?? false}
                  listingId={listing.id}
                />
              ) : null}
              <ReportEntityButton
                entityId={listing.id}
                entityName={listing.title}
                entityType="lechu"
              />
            </div>
          ) : null}
        </div>

        {hasRoute && cover ? (
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">
            <span>{lechu!.departureCountry}</span>
            <ArrowRight aria-hidden="true" className="size-3.5 text-slate-400" />
            <span>{lechu!.destinationCountry}</span>
          </p>
        ) : null}

        <p className="text-base font-semibold text-slate-800">
          {lechu?.rewardType
            ? LECHU_REWARD_LABELS[lechu.rewardType]
            : "Условия не указаны"}
        </p>
        {listing.paymentMethods?.length ? (
          <PaymentMethodIcons methods={listing.paymentMethods} size="sm" />
        ) : null}

        <div className="flex flex-wrap gap-1.5">
          {departureLabel ? (
            <span className="rounded-md bg-teal-50 px-2 py-0.5 text-xs text-teal-800">
              Вылет: {departureLabel}
            </span>
          ) : null}
          {lechu?.category ? (
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {lechu.category.nameRu}
            </span>
          ) : null}
          {carryPreview.map((label) => (
            <span
              key={label}
              className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
            >
              {label}
            </span>
          ))}
        </div>

        {location && (
          <p className="flex items-center gap-1 text-sm text-slate-600">
            <MapPin aria-hidden="true" className="size-3.5 shrink-0 text-slate-400" />
            {location}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-slate-400">
          {publisherLabel && (
            <span>
              {!preview && publisherHref ? (
                <Link
                  className="text-slate-600 hover:underline"
                  href={publisherHref}
                >
                  {publisherLabel}
                </Link>
              ) : (
                publisherLabel
              )}
            </span>
          )}
          {dateLabel && <span>{dateLabel}</span>}
        </div>

        {showStatus && (
          <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {LISTING_STATUS_LABELS[listing.status]}
          </span>
        )}
      </div>
    </article>
  );
}
