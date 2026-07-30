"use client";

import { EntitySourceCard } from "@/components/shared/EntitySourceCard";
import { isPlatformOrigin } from "@/lib/business/presence";

type ListingSourceCardProps = {
  listingId: string;
  hasSource: boolean;
  sourceUrl?: string | null;
  sourceKind?: "telegram" | "facebook" | "directory" | "platform" | null;
  isAuthenticated?: boolean;
  initiallyRevealed?: boolean;
};

/** Provenance for marketplace / services / transfers / lechu. */
export function ListingSourceCard({
  listingId,
  hasSource,
  sourceUrl = null,
  sourceKind = null,
  isAuthenticated = false,
  initiallyRevealed = false,
}: ListingSourceCardProps) {
  const platform = isPlatformOrigin({ sourceKind, sourceUrl });

  return (
    <EntitySourceCard
      anchorId="listing-source"
      fetchPath={
        platform
          ? null
          : `/api/listing/${encodeURIComponent(listingId)}/source`
      }
      hasSource={hasSource || platform}
      initiallyRevealed={initiallyRevealed || platform}
      isAuthenticated={isAuthenticated || platform}
      sourceKind={sourceKind}
      sourceUrl={sourceUrl}
    />
  );
}
