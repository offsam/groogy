"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { MapPin } from "lucide-react";
import { FavoriteButton } from "@/components/marketplace/FavoriteButton";
import { formatServicePrice } from "@/lib/listings/mappers";
import type { Listing } from "@/types/listing";
import {
  LISTING_STATUS_LABELS,
  SERVICE_MODE_LABELS,
  SERVICE_PRICING_LABELS,
} from "@/types/listing";
import { trackResourceOpen } from "@/lib/platform/engagement";

type ServiceCardProps = {
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

export function ServiceCard({
  listing,
  showFavorite = false,
  showStatus = false,
  preview = false,
}: ServiceCardProps) {
  const cover = listing.media?.[0]?.publicUrl;
  const service = listing.service;
  const dateLabel = formatDate(listing.publishedAt ?? listing.createdAt);
  const location = [listing.city, listing.state].filter(Boolean).join(", ");
  const modes = (service?.serviceModes ?? []).slice(0, 2);
  const publisherLabel =
    listing.publisher?.name ?? listing.author?.label ?? null;
  const publisherHref =
    listing.publisher?.publisherType === "business" && listing.publisher.slug
      ? `/business/${listing.publisher.slug}`
      : listing.author?.profilePath;
  const href = `/services/${listing.id}`;

  return (
    <article className="group overflow-hidden rounded-2xl border border-slate-200 bg-white transition-shadow hover:shadow-md">
      <MaybeLink
        className="block"
        href={href}
        preview={preview}
        onClick={() => trackResourceOpen({ kind: "service", id: listing.id })}
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
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              Нет фото
            </div>
          )}
        </div>
      </MaybeLink>

      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <MaybeLink
            className="line-clamp-2 font-semibold text-slate-900 hover:underline"
            href={href}
            preview={preview}
            onClick={() =>
              trackResourceOpen({ kind: "service", id: listing.id })
            }
          >
            {listing.title}
          </MaybeLink>
          {!preview && showFavorite ? (
            <FavoriteButton
              favoritesCount={listing.favoritesCount}
              initialFavorited={listing.favoritedByMe ?? false}
              listingId={listing.id}
            />
          ) : null}
        </div>

        <p className="text-lg font-bold text-slate-900">
          {service
            ? formatServicePrice(service, listing.priceCurrency)
            : "Цена не указана"}
        </p>

        <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500">
          {service?.pricingType && (
            <span>{SERVICE_PRICING_LABELS[service.pricingType]}</span>
          )}
          {service?.category && (
            <>
              <span>·</span>
              <span>{service.category.nameRu}</span>
            </>
          )}
          {modes.map((mode) => (
            <span key={mode}>· {SERVICE_MODE_LABELS[mode]}</span>
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
