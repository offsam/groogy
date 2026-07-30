"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BusinessCard } from "@/components/business/BusinessCard";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { ServiceCard } from "@/components/services/ServiceCard";
import { LechuCard } from "@/components/lechu/LechuCard";
import { TransferCard } from "@/components/transfers/TransferCard";
import { EmptyState } from "@/components/ui/DataState";
import { POPULAR_RESOURCE_KIND_LABEL } from "@/lib/platform/resource-kinds";
import type { PopularHomeItem } from "@/lib/platform/popular-resources";
import { withHubParam } from "@/lib/regions/hubs";

type PopularResourcesSectionProps = {
  items: PopularHomeItem[];
  hubIdsParam: string;
  /** Hub used for SSR items — skip client refetch until region changes. */
  initialHubId: string;
};

function KindBadge({ label }: { label: string }) {
  return (
    <span className="mb-2 inline-block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
      {label}
    </span>
  );
}

function PopularItemCard({ item }: { item: PopularHomeItem }) {
  const label = POPULAR_RESOURCE_KIND_LABEL[item.kind];
  switch (item.kind) {
    case "business":
      return (
        <div>
          <KindBadge label={label} />
          <BusinessCard business={item.business} />
        </div>
      );
    case "marketplace":
      return (
        <div>
          <KindBadge label={label} />
          <ListingCard listing={item.listing} />
        </div>
      );
    case "service":
      return (
        <div>
          <KindBadge label={label} />
          <ServiceCard listing={item.listing} />
        </div>
      );
    case "lechu":
      return (
        <div>
          <KindBadge label={label} />
          <LechuCard listing={item.listing} />
        </div>
      );
    case "transfer":
      return (
        <div>
          <KindBadge label={label} />
          <TransferCard listing={item.listing} />
        </div>
      );
  }
}

export function PopularResourcesSection({
  items: initial,
  hubIdsParam,
  initialHubId,
}: PopularResourcesSectionProps) {
  const [items, setItems] = useState(initial);

  useEffect(() => {
    setItems(initial);
  }, [initial]);

  useEffect(() => {
    // Keep SSR feed until the user changes region away from the SSR hub.
    // Empty hubIdsParam = national / platform-wide (matches SSR when initialHubId is "").
    if (hubIdsParam === initialHubId) {
      setItems(initial);
      return;
    }

    let cancelled = false;
    async function load() {
      try {
        const qs = hubIdsParam
          ? `hub=${encodeURIComponent(hubIdsParam)}`
          : "hub=all";
        const res = await fetch(`/api/popular-resources?${qs}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { items?: PopularHomeItem[] };
        if (!cancelled && Array.isArray(data.items)) {
          setItems(data.items);
        }
      } catch {
        // keep last
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [hubIdsParam, initialHubId, initial]);

  return (
    <section className="mx-auto max-w-[1400px] px-3 pb-12 pt-4 sm:px-6 sm:pb-16 sm:pt-6 lg:px-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            Популярное
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Микс бизнесов и объявлений — то, что чаще открывают.
          </p>
        </div>
        <Link
          className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
          href={withHubParam("/search", hubIdsParam)}
        >
          Смотреть каталог
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>

      {items.length === 0 ? (
        <EmptyState
          description="Когда появятся публикации и открытия, здесь соберётся лента."
          title="Пока пусто"
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const key =
              item.kind === "business"
                ? `business-${item.business.id}`
                : `${item.kind}-${item.listing.id}`;
            return <PopularItemCard key={key} item={item} />;
          })}
        </div>
      )}
    </section>
  );
}
