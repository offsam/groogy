import Image from "next/image";
import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import { FavoriteButton } from "@/components/marketplace/FavoriteButton";
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

export function TransferCard({
  listing,
  showFavorite = false,
  showStatus = false,
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

  return (
    <article className="group overflow-hidden rounded-2xl border border-slate-200 bg-white transition-shadow hover:shadow-md">
      <Link
        className="block"
        href={`/transfers/${listing.id}`}
        onClick={() => trackResourceOpen({ kind: "transfer", id: listing.id })}
      >        <div className="relative aspect-[4/3] bg-slate-100">
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
      </Link>

      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <Link
            className="line-clamp-2 font-semibold text-slate-900 hover:underline"
            href={`/transfers/${listing.id}`}
            onClick={() =>
              trackResourceOpen({ kind: "transfer", id: listing.id })
            }
          >
            {listing.title}
          </Link>
          {showFavorite && (
            <FavoriteButton
              favoritesCount={listing.favoritesCount}
              initialFavorited={listing.favoritedByMe ?? false}
              listingId={listing.id}
            />
          )}
        </div>

        {transfer && (
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">
            <span>{transfer.fromCountry}</span>
            <ArrowRight aria-hidden="true" className="size-3.5 text-slate-400" />
            <span>{transfer.toCountry}</span>
          </p>
        )}

        <p className="text-lg font-bold text-slate-900">{formatFee(listing)}</p>

        <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500">
          {transfer?.transferMethod && (
            <span>{TRANSFER_METHOD_LABELS[transfer.transferMethod]}</span>
          )}
          {transfer?.category && (
            <>
              <span>·</span>
              <span>{transfer.category.nameRu}</span>
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
          {publisherLabel && (
            <span>
              {publisherHref ? (
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
