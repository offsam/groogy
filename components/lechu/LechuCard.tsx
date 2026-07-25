import Image from "next/image";
import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import { FavoriteButton } from "@/components/marketplace/FavoriteButton";
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
};

function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

export function LechuCard({
  listing,
  showFavorite = false,
  showStatus = false,
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
    .map((t) => LECHU_CARRY_TYPE_LABELS[t as keyof typeof LECHU_CARRY_TYPE_LABELS] ?? t);

  return (
    <article className="group overflow-hidden rounded-2xl border border-slate-200 bg-white transition-shadow hover:shadow-md">
      <Link
        className="block"
        href={`/lechu/${listing.id}`}
        onClick={() => trackResourceOpen({ kind: "lechu", id: listing.id })}
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
            href={`/lechu/${listing.id}`}
            onClick={() => trackResourceOpen({ kind: "lechu", id: listing.id })}
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

        {lechu && (
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">
            <span>{lechu.departureCountry}</span>
            <ArrowRight aria-hidden="true" className="size-3.5 text-slate-400" />
            <span>{lechu.destinationCountry}</span>
          </p>
        )}

        <p className="text-lg font-bold text-slate-900">
          {lechu?.rewardType
            ? LECHU_REWARD_LABELS[lechu.rewardType]
            : "Условия не указаны"}
        </p>

        <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500">
          {departureLabel && <span>Вылет: {departureLabel}</span>}
          {lechu?.category && (
            <>
              {departureLabel && <span>·</span>}
              <span>{lechu.category.nameRu}</span>
            </>
          )}
          {carryPreview.map((label) => (
            <span key={label}>· {label}</span>
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
