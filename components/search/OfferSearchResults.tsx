"use client";

import { useEffect, useState } from "react";
import { BusinessOfferCard } from "@/components/business-offers/BusinessOfferCard";
import { LoadingState } from "@/components/ui/DataState";
import { searchPublicOffers } from "@/lib/business-offers/queries";
import { createBrowserClient } from "@/lib/supabase/client";
import type { BusinessOffer } from "@/types/business-offer";

type OfferSearchResultsProps = {
  query: string;
  city?: string | null;
};

export function OfferSearchResults({ query, city }: OfferSearchResultsProps) {
  const [offers, setOffers] = useState<BusinessOffer[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setOffers([]);
      return;
    }

    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const client = createBrowserClient();
        const data = await searchPublicOffers(client, {
          query: q,
          city: city ?? undefined,
        });
        if (!cancelled) setOffers(data);
      } catch {
        if (!cancelled) setOffers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [query, city]);

  if (!query.trim()) return null;
  if (loading) return <LoadingState label="Ищем предложения…" />;
  if (offers.length === 0) return null;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">
        Предложения ({offers.length})
      </h2>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {offers.map((offer) => (
          <BusinessOfferCard
            key={offer.id}
            businessSlug={offer.businessSlug ?? ""}
            offer={offer}
            presence={offer.presence}
          />
        ))}
      </div>
    </section>
  );
}
