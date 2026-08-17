"use client";

import { useEffect, useRef } from "react";
import { BusinessCard } from "@/components/business/BusinessCard";
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

const PENDING_SLOTS = 6;

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

  if (!pending && businesses.length === 0) {
    return <EmptyState />;
  }

  const slots: Array<Business | null> = pending
    ? Array.from({ length: PENDING_SLOTS }, () => null)
    : businesses;

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {slots.map((business, index) => (
        <li
          className="business-card-slot"
          key={business?.id ?? `pending-${index}`}
          ref={(node) => {
            if (!business) return;
            if (node) itemRefs.current.set(business.id, node);
            else itemRefs.current.delete(business.id);
          }}
        >
          {business ? (
            <div className={reveal ? "ai-search-card-reveal h-full" : "h-full"}>
              <BusinessCard
                business={business}
                onSelect={onSelect}
                selected={business.id === selectedId}
              />
            </div>
          ) : (
            <div
              className="ai-search-skel"
              style={{ animationDelay: `${index * 0.12}s` }}
            >
              <span className="ai-search-skel__photo" />
              <span className="ai-search-skel__copy">
                <span />
                <span />
                <span />
              </span>
              <span className="ai-search-skel__shine" />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
