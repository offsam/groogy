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
  businessAlreadyClaimed?: boolean;
  /**
   * When set (e.g. restaurants → «Меню»), the profile tab already has that
   * name — do not repeat it as an h2, and do not show type pills.
   */
  sectionLabel?: string | null;
  /** Group menu_item offers under attributes.menu_section headings. */
  groupMenuBySection?: boolean;
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

function menuSectionOf(offer: BusinessOffer): string {
  const attrs = offer.attributes as { menu_section?: string | null } | null;
  return attrs?.menu_section?.trim() || "";
}

function groupMenuOffersBySection(
  offers: BusinessOffer[],
): Array<{ section: string; items: BusinessOffer[] }> {
  const order: string[] = [];
  const map = new Map<string, BusinessOffer[]>();
  for (const offer of offers) {
    const section = menuSectionOf(offer);
    if (!section) continue;
    if (!map.has(section)) {
      order.push(section);
      map.set(section, []);
    }
    map.get(section)!.push(offer);
  }
  // Items without a section — one untitled group at the end
  const unsectioned = offers.filter((o) => !menuSectionOf(o));
  if (unsectioned.length) {
    order.push("");
    map.set("", unsectioned);
  }
  return order.map((section) => ({ section, items: map.get(section)! }));
}

export function BusinessOffersSection({
  offers,
  businessSlug,
  presence = null,
  businessAlreadyClaimed = false,
  sectionLabel = null,
  groupMenuBySection = false,
}: BusinessOffersSectionProps) {
  const groups = useMemo(() => groupOffersByType(offers), [offers]);
  const types = TYPE_ORDER.filter((t) => (groups[t]?.length ?? 0) > 0);
  const [activeType, setActiveType] = useState<BusinessOfferType>(
    types[0] ?? "service",
  );

  const restaurantMenuMode = Boolean(sectionLabel?.trim());

  const visible = useMemo(() => {
    if (restaurantMenuMode) {
      // Profile «Меню» tab: only dishes, no type switcher / «Предложения».
      return offers.filter((o) => o.offerType === "menu_item");
    }
    return types.length <= 1 ? offers : (groups[activeType] ?? []);
  }, [restaurantMenuMode, offers, types.length, groups, activeType]);

  const showingMenu =
    groupMenuBySection &&
    visible.length > 0 &&
    visible.every((o) => o.offerType === "menu_item");

  const menuSections = useMemo(
    () => (showingMenu ? groupMenuOffersBySection(visible) : null),
    [showingMenu, visible],
  );

  if (offers.length === 0) return null;
  if (restaurantMenuMode && visible.length === 0) return null;

  // Tab already says «Меню» / «Услуги» — no second title above the list.
  const heading = restaurantMenuMode
    ? null
    : types.length === 1 && types[0]
      ? OFFER_TYPE_LABELS[types[0]]
      : "Предложения";

  return (
    <section className="space-y-4" id="offers">
      {heading ? (
        <h2 className="text-xl font-semibold text-slate-900">{heading}</h2>
      ) : null}

      {!restaurantMenuMode && types.length > 1 ? (
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
      ) : null}

      {menuSections && menuSections.length > 0 ? (
        <div className="space-y-6">
          {menuSections.map(({ section, items }) => (
            <div key={section || "other"} className="space-y-3">
              {section ? (
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {section}
                </h3>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {items.map((offer) => (
                  <BusinessOfferCard
                    key={offer.id}
                    businessAlreadyClaimed={businessAlreadyClaimed}
                    businessSlug={businessSlug}
                    offer={offer}
                    presence={presence}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {visible.map((offer) => (
            <BusinessOfferCard
              key={offer.id}
              businessAlreadyClaimed={businessAlreadyClaimed}
              businessSlug={businessSlug}
              offer={offer}
              presence={presence}
            />
          ))}
        </div>
      )}
    </section>
  );
}
