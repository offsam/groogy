"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { FavoriteButton } from "@/components/marketplace/FavoriteButton";
import { ReportEntityButton } from "@/components/support/ReportEntityButton";
import { LechuRoutePlaque } from "@/components/lechu/LechuRoutePlaque";
import type { Listing } from "@/types/listing";
import { LISTING_STATUS_LABELS } from "@/types/listing";
import { trackResourceOpen } from "@/lib/platform/engagement";
import { cn } from "@/lib/utils";

type LechuCardProps = {
  listing: Listing;
  showFavorite?: boolean;
  showStatus?: boolean;
  preview?: boolean;
};

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

/**
 * List face = route plaque only. Publisher / reward / carry open on the
 * detail page after tap.
 */
export function LechuCard({
  listing,
  showFavorite = false,
  showStatus = false,
  preview = false,
}: LechuCardProps) {
  const lechu = listing.lechu;
  const href = `/lechu/${listing.id}`;
  const from = lechu?.departureCountry?.trim() || "Откуда";
  const to = lechu?.destinationCountry?.trim() || "Куда";

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-slate-200 bg-white transition-shadow hover:border-slate-300 hover:shadow-md",
      )}
    >
      <div className="h-1 bg-gradient-to-r from-brand-blue via-brand-green to-brand-blue/40" />
      <MaybeLink
        className="block min-h-[5.5rem] px-3.5 py-3.5 sm:px-4 sm:py-4"
        href={href}
        preview={preview}
        onClick={() => trackResourceOpen({ kind: "lechu", id: listing.id })}
      >
        <LechuRoutePlaque
          departure={from}
          destination={to}
          departureDate={lechu?.departureDate ?? null}
        />
      </MaybeLink>

      {!preview ? (
        <div className="absolute right-2 top-3 z-10 flex items-center gap-1.5">
          {showFavorite ? (
            <FavoriteButton
              favoritesCount={listing.favoritesCount}
              initialFavorited={listing.favoritedByMe ?? false}
              listingId={listing.id}
            />
          ) : null}
          <ReportEntityButton
            entityId={listing.id}
            entityName={`${from} → ${to}`}
            entityType="lechu"
          />
        </div>
      ) : null}

      {showStatus ? (
        <div className="border-t border-slate-100 px-3.5 py-2">
          <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {LISTING_STATUS_LABELS[listing.status]}
          </span>
        </div>
      ) : null}
    </article>
  );
}
