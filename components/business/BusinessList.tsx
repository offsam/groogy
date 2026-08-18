"use client";

import { useEffect, useRef } from "react";
import { BusinessCard } from "@/components/business/BusinessCard";
import { PendingTile } from "@/components/search/SearchPendingTiles";
import { EmptyState } from "@/components/ui/DataState";
import type { Business } from "@/types/business";

type BusinessListProps = {
  businesses: Business[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /**
   * Trailing shimmer tiles for results still streaming in from AI search —
   * same grid as the real cards, so cards fill in slot by slot instead of
   * the whole layout swapping from skeleton to grid at once.
   */
  pendingSlots?: number;
  /** Fade each card's photo/copy in as it mounts (blur→sharp), for AI search results. */
  reveal?: boolean;
};

export function BusinessList({
  businesses,
  selectedId,
  onSelect,
  pendingSlots = 0,
  reveal = false,
}: BusinessListProps) {
  const itemRefs = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => {
    if (!selectedId) return;
    itemRefs.current
      .get(selectedId)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedId]);

  if (businesses.length === 0 && pendingSlots === 0) {
    return <EmptyState />;
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {businesses.map((business) => (
        <li
          className="business-card-slot"
          key={business.id}
          ref={(node) => {
            if (node) itemRefs.current.set(business.id, node);
            else itemRefs.current.delete(business.id);
          }}
        >
          <div className={reveal ? "ai-search-card-reveal h-full" : "h-full"}>
            <BusinessCard
              business={business}
              onSelect={onSelect}
              selected={business.id === selectedId}
            />
          </div>
        </li>
      ))}
      {Array.from({ length: Math.max(pendingSlots, 0) }, (_, index) => (
        <li className="business-card-slot" key={`pending-${index}`}>
          <PendingTile delay={index * 0.12} />
        </li>
      ))}
    </ul>
  );
}
