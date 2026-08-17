"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { MapPin, ShoppingBag } from "lucide-react";
import {
  CategoryAccentBar,
  CategoryChip,
  CategoryMediaFallback,
} from "@/components/platform/CategoryCardChrome";
import { FavoriteButton } from "@/components/marketplace/FavoriteButton";
import { PaymentMethodIcons } from "@/components/shared/PaymentMethodIcons";
import { formatPrice } from "@/lib/listings/mappers";
import type { Listing } from "@/types/listing";
import {
  CONDITION_LABELS,
  LISTING_STATUS_LABELS,
  TRANSACTION_LABELS,
} from "@/types/listing";
import { trackResourceOpen } from "@/lib/platform/engagement";

type ListingCardProps = {
  listing: Listing;
  showFavorite?: boolean;
  showStatus?: boolean;
  /** Admin / moderation: no public links or analytics. */
  preview?: boolean;
};

function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function publisherLabel(listing: Listing) {
  if (listing.publisher?.name) {
    if (listing.publisher.publisherType === "business" && listing.publisher.slug) {
      return {
        label: listing.publisher.name,
        href: `/business/${listing.publisher.slug}`,
      };
    }
    if (listing.publisher.author?.profilePath) {
      return {
        label: listing.publisher.name,
        href: listing.publisher.author.profilePath,
      };
    }
    return { label: listing.publisher.name, href: null as string | null };
  }
  if (listing.author) {
    return {
      label: listing.author.label,
      href: listing.author.profilePath,
    };
  }
  return null;
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
  if (preview) {
    return <div className={className}>{children}</div>;
  }
  return (
    <Link className={className} href={href} onClick={onClick}>
      {children}
    </Link>
  );
}

export function ListingCard({
  listing,
  showFavorite = false,
  showStatus = false,
  preview = false,
}: ListingCardProps) {
  const cover = listing.media?.[0]?.publicUrl;
  const transactionType = listing.marketplace?.transactionType ?? "sell";
  const dateLabel = formatDate(listing.publishedAt ?? listing.createdAt);
  const location = [listing.city, listing.state].filter(Boolean).join(", ");
  const publisher = publisherLabel(listing);
  const href = `/marketplace/${listing.id}`;

  return (
    <article className="group overflow-hidden rounded-2xl border border-slate-200 bg-white transition-shadow hover:shadow-md">
      <CategoryAccentBar theme="marketplace" />
      <MaybeLink
        className="block"
        href={href}
        preview={preview}
        onClick={() =>
          trackResourceOpen({ kind: "marketplace", id: listing.id })
        }
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
            <CategoryMediaFallback
              icon={ShoppingBag}
              theme="marketplace"
            />
          )}
        </div>
      </MaybeLink>

      <div className="space-y-2 p-4">
        <CategoryChip theme="marketplace" />

        <div className="flex min-w-0 items-start justify-between gap-2">
          <MaybeLink
            className="min-w-0 line-clamp-2 font-semibold text-slate-900 hover:underline"
            href={href}
            preview={preview}
            onClick={() =>
              trackResourceOpen({ kind: "marketplace", id: listing.id })
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
          {formatPrice(
            listing.priceAmount,
            listing.priceCurrency,
            transactionType,
          )}
          {listing.isNegotiable && transactionType === "sell" && (
            <span className="ml-1 text-sm font-normal text-slate-500">
              · торг
            </span>
          )}
        </p>
        {listing.paymentMethods?.length ? (
          <PaymentMethodIcons methods={listing.paymentMethods} size="sm" />
        ) : null}

        <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500">
          <span>{TRANSACTION_LABELS[transactionType]}</span>
          {listing.marketplace?.condition && (
            <>
              <span>·</span>
              <span>{CONDITION_LABELS[listing.marketplace.condition]}</span>
            </>
          )}
          {listing.marketplace?.category && (
            <>
              <span>·</span>
              <span>{listing.marketplace.category.nameRu}</span>
            </>
          )}
        </div>

        {location && (
          <p className="flex items-center gap-1 text-sm text-slate-600">
            <MapPin aria-hidden="true" className="size-3.5 shrink-0 text-slate-400" />
            {location}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-slate-400">
          {publisher && (
            <span>
              {!preview && publisher.href ? (
                <Link
                  className="text-slate-600 hover:underline"
                  href={publisher.href}
                >
                  {publisher.label}
                </Link>
              ) : (
                publisher.label
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
