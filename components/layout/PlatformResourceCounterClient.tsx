"use client";

import { useEffect, useState } from "react";
import {
  pluralBusinessCards,
  pluralCategories,
  pluralLechu,
  pluralListings,
  pluralMembers,
  pluralOffers,
  pluralReviews,
  pluralServices,
  pluralTransfers,
  pluralUpdates,
  type PlatformResourceStats,
} from "@/lib/platform/resource-stats";

type CounterPart = {
  key: string;
  value: string;
  label: string;
};

function formatDelta(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function buildParts(stats: PlatformResourceStats): CounterPart[] {
  const parts: CounterPart[] = [
    {
      key: "businesses",
      value: stats.businesses.toLocaleString("ru-RU"),
      label: pluralBusinessCards(stats.businesses),
    },
  ];

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

  pushCount("offers", stats.offers, pluralOffers);
  pushCount("listings", stats.listings, pluralListings);
  pushCount("services", stats.services, pluralServices);
  pushCount("transfers", stats.transfers, pluralTransfers);
  pushCount("lechu", stats.lechu, pluralLechu);
  pushCount("reviews", stats.reviews, pluralReviews);
  pushCount("categories", stats.categories, pluralCategories);
  pushCount("members", stats.members, pluralMembers);

  if (stats.addedYesterday > 0) {
    parts.push({
      key: "added-yesterday",
      value: formatDelta(stats.addedYesterday),
      label: "добавлено вчера",
    });
  }
  if (stats.addedToday > 0) {
    parts.push({
      key: "added-today",
      value: formatDelta(stats.addedToday),
      label: "добавлено сегодня",
    });
  }
  if (stats.updatedToday > 0) {
    parts.push({
      key: "updated-today",
      value: formatDelta(stats.updatedToday),
      label: `${pluralUpdates(stats.updatedToday)} сегодня`,
    });
  }
  if (stats.membersToday > 0) {
    parts.push({
      key: "members-today",
      value: formatDelta(stats.membersToday),
      label: "новые участники сегодня",
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

  if (stats.businesses <= 0) return null;

  const parts = buildParts(stats);

  return (
    <div className="border-b border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-[1400px] px-4 py-1.5 sm:px-6 lg:px-8">
        <p className="flex flex-nowrap items-center overflow-x-auto whitespace-nowrap text-xs text-slate-600 sm:text-sm">
          <span className="shrink-0 pr-1 text-slate-500">На платформе</span>
          {parts.map((part) => (
            <span
              key={part.key}
              className="inline-flex shrink-0 items-center"
            >
              <span className="mx-1.5 text-slate-300" aria-hidden="true">
                ·
              </span>
              <span className="tabular-nums">
                <span className="font-semibold text-slate-900">{part.value}</span>{" "}
                <span className="text-slate-600">{part.label}</span>
              </span>
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}
