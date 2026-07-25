"use client";

import { useEffect, useRef } from "react";
import { BusinessCard } from "@/components/business/BusinessCard";
import { EmptyState } from "@/components/ui/DataState";
import type { Business } from "@/types/business";

type BusinessListProps = {
  businesses: Business[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function BusinessList({ businesses, selectedId, onSelect }: BusinessListProps) {
  const itemRefs = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => {
    if (!selectedId) return;
    itemRefs.current
      .get(selectedId)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedId]);

  if (businesses.length === 0) {
    return <EmptyState />;
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {businesses.map((business) => (
        <li
          key={business.id}
          ref={(node) => {
            if (node) itemRefs.current.set(business.id, node);
            else itemRefs.current.delete(business.id);
          }}
        >
          <BusinessCard
            business={business}
            onSelect={onSelect}
            selected={business.id === selectedId}
          />
        </li>
      ))}
    </ul>
  );
}
