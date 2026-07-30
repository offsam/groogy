"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeftRight, ArrowRight, MapPin } from "lucide-react";
import {
  CategoryAccentBar,
  CategoryChip,
  CategoryMediaFallback,
} from "@/components/platform/CategoryCardChrome";
import { FavoriteButton } from "@/components/marketplace/FavoriteButton";
import { PaymentMethodIcons } from "@/components/shared/PaymentMethodIcons";
import type { Listing } from "@/types/listing";
import {
  LISTING_STATUS_LABELS,
  TRANSFER_METHOD_LABELS,
} from "@/types/listing";
import { trackResourceOpen } from "@/lib/platform/engagement";

type TransferCardProps = {
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

function formatFee(listing: Listing) {
  const transfer = listing.transfer;
  if (!transfer) return "Комиссия не указана";
  const parts: string[] = [];
  if (transfer.feePercent != null) {
    parts.push(`${transfer.feePercent}%`);
  }
  if (transfer.feeFixedUsd != null) {
    parts.push(
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: listing.priceCurrency || "USD",
        maximumFractionDigits: 0,
      }).format(transfer.feeFixedUsd),
    );
  }
  return parts.length ? parts.join(" + ") : "Комиссия не указана";
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
      className={`flex flex-wrap items-center justify-center gap-1.5 text-center text-sm font-semibold text-sky-900 ${className}`}
    >
      <span className="line-clamp-1 max-w-[40%]">{from}</span>
      <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 text-sky-600" />
      <span className="line-clamp-1 max-w-[40%]">{to}</span>
    </p>
  );
}

export function TransferCard({
  listing,
  showFavorite = false,
  showStatus = false,
  preview = false,
}: TransferCardProps) {
  const cover = listing.media?.[0]?.publicUrl;
  const transfer = listing.transfer;
  const dateLabel = formatDate(listing.publishedAt ?? listing.createdAt);
  const location = [listing.city, listing.state].filter(Boolean).join(", ");
  const publisherLabel =
    listing.publisher?.name ?? listing.author?.label ?? null;
  const publisherHref =
    listing.publisher?.publisherType === "business" && listing.publisher.slug
      ? `/business/${listing.publisher.slug}`
      : listing.author?.profilePath;
  const href = `/transfers/${listing.id}`;
  const hasRoute = Boolean(transfer?.fromCountry && transfer?.toCountry);

  return (
    <article className="group overflow-hidden rounded-2xl border border-slate-200 bg-white transition-shadow hover:shadow-md">
      <CategoryAccentBar theme="transfers" />
      <MaybeLink
        className="block"
        href={href}
        preview={preview}
        onClick={() => trackResourceOpen({ kind: "transfer", id: listing.id })}
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
            <CategoryMediaFallback icon={ArrowLeftRight} theme="transfers">
              {hasRoute ? (
                <RouteLine
                  from={transfer!.fromCountry}
                  to={transfer!.toCountry}
                  className="mt-1 px-1"
                />
              ) : null}
            </CategoryMediaFallback>
          )}
        </div>
      </MaybeLink>

      <div className="space-y-2 p-4">
        <CategoryChip theme="transfers" />

        <div className="flex items-start justify-between gap-2">
          <MaybeLink
            className="line-clamp-2 font-semibold text-slate-900 hover:underline"
            href={href}
            preview={preview}
            onClick={() =>
              trackResourceOpen({ kind: "transfer", id: listing.id })
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

        {hasRoute && cover ? (
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">
            <span>{transfer!.fromCountry}</span>
            <ArrowRight aria-hidden="true" className="size-3.5 text-slate-400" />
            <span>{transfer!.toCountry}</span>
          </p>
        ) : null}

        <p className="text-lg font-bold text-slate-900">{formatFee(listing)}</p>
        {listing.paymentMethods?.length ? (
          <PaymentMethodIcons methods={listing.paymentMethods} size="sm" />
        ) : null}

        <div className="flex flex-wrap gap-1.5">
          {transfer?.transferMethod ? (
            <span className="rounded-md bg-brand-blue/10 px-2 py-0.5 text-xs text-blue-900">
              {TRANSFER_METHOD_LABELS[transfer.transferMethod]}
            </span>
          ) : null}
          {transfer?.category ? (
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {transfer.category.nameRu}
            </span>
          ) : null}
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
