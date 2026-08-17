"use client";

import { useEffect, useRef } from "react";
import { BusinessCard } from "@/components/business/BusinessCard";
import { SearchPendingTiles } from "@/components/search/SearchPendingTiles";
import { EmptyState } from "@/components/ui/DataState";
import type { Business } from "@/types/business";

type BusinessListProps = {
  businesses: Business[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Equal-size shimmer tiles while AI search is in flight. */
  pending?: boolean;
  /** Fade photo/copy into the same-size tile after search. */
  reveal?: boolean;
};

export function BusinessList({
  businesses,
  selectedId,
  onSelect,
  pending = false,
  reveal = false,
}: BusinessListProps) {
  const itemRefs = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => {
    if (!selectedId) return;
    itemRefs.current
      .get(selectedId)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedId]);

  if (pending) {
    return <SearchPendingTiles />;
  }

  if (businesses.length === 0) {
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
    </ul>
  );
}
