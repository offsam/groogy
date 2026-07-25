"use client";

import { useMemo, useState } from "react";
import type { BusinessOffer, BusinessOfferType } from "@/types/business-offer";
import { OFFER_TYPE_LABELS } from "@/types/business-offer";
import type { BusinessPresence } from "@/lib/business/presence";
import { groupOffersByType } from "@/lib/business-offers/mappers";
import { BusinessOfferCard } from "@/components/business-offers/BusinessOfferCard";
import { cn } from "@/lib/utils";

type BusinessOffersSectionProps = {
  offers: BusinessOffer[];
  businessSlug: string;
  presence?: BusinessPresence | null;
};

const TYPE_ORDER: BusinessOfferType[] = [
  "service",
  "product",
  "vehicle",
  "property",
  "rental",
  "menu_item",
  "other",
];

export function BusinessOffersSection({
  offers,
  businessSlug,
  presence = null,
}: BusinessOffersSectionProps) {
  const groups = useMemo(() => groupOffersByType(offers), [offers]);
  const types = TYPE_ORDER.filter((t) => (groups[t]?.length ?? 0) > 0);
  const [activeType, setActiveType] = useState<BusinessOfferType>(types[0] ?? "service");

  if (offers.length === 0) return null;

  const visible =
    types.length <= 1 ? offers : (groups[activeType] ?? []);

  const sectionTitle =
    types.length === 1 && types[0]
      ? OFFER_TYPE_LABELS[types[0]]
      : "Предложения";

  return (
    <section className="space-y-4" id="offers">
      <h2 className="text-xl font-semibold text-slate-900">{sectionTitle}</h2>

      {types.length > 1 && (
        <div className="flex flex-wrap gap-2 border-b border-slate-100 pb-3">
          {types.map((type) => (
            <button
              key={type}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                activeType === type
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200",
              )}
              onClick={() => setActiveType(type)}
              type="button"
            >
              {OFFER_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((offer) => (
          <BusinessOfferCard
            key={offer.id}
            businessSlug={businessSlug}
            offer={offer}
            presence={presence}
          />
        ))}
      </div>
    </section>
  );
}
