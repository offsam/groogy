"use client";

import { useEffect, useState } from "react";
import {
  pluralBusinessCards,
  pluralCategories,
  pluralLechu,
  pluralListings,
  pluralMembers,
  pluralOffers,
  pluralResources,
  pluralReviews,
  pluralServices,
  pluralTransfers,
  pluralUpdates,
  type PlatformResourceStats,
} from "@/lib/platform/resource-stats";
import { cn } from "@/lib/utils";

type CounterPart = {
  key: string;
  value: string;
  label: string;
  tone?: "default" | "green" | "muted";
};

function formatDelta(n: number): string {
  return n > 0 ? `+${n.toLocaleString("ru-RU")}` : `${n}`;
}

function buildParts(stats: PlatformResourceStats): CounterPart[] {
  const parts: CounterPart[] = [];

  const pushCount = (
    key: string,
    count: number,
    plural: (n: number) => string,
  ) => {
    if (count <= 0) return;
    parts.push({
      key,
      value: count.toLocaleString("ru-RU"),
      label: plural(count),
    });
  };

  pushCount("businesses", stats.businesses, pluralBusinessCards);
  pushCount("offers", stats.offers, pluralOffers);
  pushCount("listings", stats.listings, pluralListings);
  pushCount("services", stats.services, pluralServices);
  pushCount("transfers", stats.transfers, pluralTransfers);
  pushCount("lechu", stats.lechu, pluralLechu);
  pushCount("reviews", stats.reviews, pluralReviews);
  pushCount("categories", stats.categories, pluralCategories);
  pushCount("members", stats.members, pluralMembers);

  if (stats.addedToday > 0) {
    parts.push({
      key: "added-today",
      value: formatDelta(stats.addedToday),
      label: "сегодня",
      tone: "green",
    });
  }
  if (stats.addedYesterday > 0) {
    parts.push({
      key: "added-yesterday",
      value: formatDelta(stats.addedYesterday),
      label: "вчера",
      tone: "muted",
    });
  }
  if (stats.updatedToday > 0) {
    parts.push({
      key: "updated-today",
      value: formatDelta(stats.updatedToday),
      label: `${pluralUpdates(stats.updatedToday)} сегодня`,
      tone: "muted",
    });
  }
  if (stats.membersToday > 0) {
    parts.push({
      key: "members-today",
      value: formatDelta(stats.membersToday),
      label: "участников сегодня",
      tone: "green",
    });
  }

  return parts;
}

const POLL_MS = 30_000;

export function PlatformResourceCounterClient({
  initial,
}: {
  initial: PlatformResourceStats;
}) {
  const [stats, setStats] = useState(initial);

  useEffect(() => {
    setStats(initial);
  }, [initial]);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const res = await fetch("/api/platform-stats", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as PlatformResourceStats;
        if (!cancelled && typeof data.businesses === "number") {
          setStats(data);
        }
      } catch {
        // Keep last good value
      }
    }

    const id = window.setInterval(refresh, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (stats.businesses <= 0 && stats.total <= 0) return null;

  const parts = buildParts(stats);
  const totalLabel = pluralResources(stats.total || stats.businesses);
  const totalValue = (stats.total || stats.businesses).toLocaleString("ru-RU");

  return (
    <div className="relative border-y border-slate-200/80 bg-gradient-to-r from-slate-50 via-white to-slate-50">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-blue/35 to-transparent"
      />
      <div className="mx-auto flex max-w-[1400px] flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-4 sm:px-6 sm:py-3 lg:px-8">
        <div className="flex shrink-0 items-baseline gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            На платформе
          </span>
          <span className="font-[family-name:var(--font-display)] text-lg font-semibold tabular-nums leading-none text-slate-900 sm:text-xl">
            {totalValue}
          </span>
          <span className="text-sm text-slate-500">{totalLabel}</span>
        </div>

        <div
          aria-hidden
          className="hidden h-5 w-px shrink-0 bg-slate-200 sm:block"
        />

        <ul className="flex min-w-0 flex-1 list-none items-center gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:gap-2 [&::-webkit-scrollbar]:hidden">
          {parts.map((part) => (
            <li key={part.key} className="shrink-0">
              <span
                className={cn(
                  "inline-flex items-baseline gap-1 rounded-full border px-2.5 py-1 text-[11px] sm:text-xs",
                  part.tone === "green"
                    ? "border-brand-green/25 bg-brand-green/10 text-emerald-800"
                    : part.tone === "muted"
                      ? "border-slate-200/80 bg-slate-50 text-slate-500"
                      : "border-slate-200/90 bg-white text-slate-700 shadow-[0_1px_0_rgba(15,23,42,0.03)]",
                )}
              >
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    part.tone === "green"
                      ? "text-brand-green"
                      : part.tone === "muted"
                        ? "text-slate-600"
                        : "text-slate-900",
                  )}
                >
                  {part.value}
                </span>
                <span className="whitespace-nowrap">{part.label}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
