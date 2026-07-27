"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { HubResourceStats } from "@/lib/platform/hub-resource-stats";
import type { PlatformSectionKey } from "@/lib/platform/sections";
import { cn } from "@/lib/utils";

/** Poll while the tab is open so +today updates if something is published mid-session. */
const STATS_POLL_MS = 45_000;

function formatDelta(n: number) {
  return `+${n.toLocaleString("ru-RU")}`;
}

/** Map home platform section → hub-resource-stats card key. */
const SECTION_STAT_KEY: Record<PlatformSectionKey, string> = {
  businesses: "businesses",
  professionals: "professionals",
  marketplace: "listings",
  jobs: "jobs",
  real_estate: "real_estate",
  events: "events",
  vehicles: "vehicles",
  lechu: "lechu",
  transfers: "transfers",
};

export function sectionStatFromHub(
  stats: HubResourceStats | null,
  sectionKey: PlatformSectionKey,
): { count: number; addedToday: number } | null {
  if (!stats) return null;
  const cardKey = SECTION_STAT_KEY[sectionKey];
  const card = stats.cards.find((c) => c.key === cardKey);
  if (!card) return null;
  return {
    count: card.count,
    addedToday: card.addedToday ?? 0,
  };
}

export function useHubRegionStats(
  hubId: string,
  initial: HubResourceStats | null,
  ssrHubId?: string,
): HubResourceStats | null {
  // Keep SSR stats visible immediately — don't blank the hero line while refetching
  // (guest hub from localStorage often differs from the SSR hub id).
  const [stats, setStats] = useState<HubResourceStats | null>(initial);

  useEffect(() => {
    if (initial && ssrHubId && hubId === ssrHubId) {
      setStats(initial);
    }
  }, [initial, hubId, ssrHubId]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    async function load() {
      try {
        const res = await fetch(
          `/api/hub-resource-stats?hub=${encodeURIComponent(hubId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as HubResourceStats;
        if (!cancelled && Array.isArray(data.cards)) {
          setStats(data);
        }
      } catch {
        // keep last (including SSR)
      }
    }

    const schedule = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "hidden") return;
      timer = window.setTimeout(() => {
        void load().finally(schedule);
      }, STATS_POLL_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void load().finally(schedule);
      } else {
        window.clearTimeout(timer);
      }
    };

    void load().finally(schedule);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hubId]);

  return stats;
}

/** Compact region totals under «в {region}» on the hero photo. */
export function HomeRegionActivityLine({
  stats,
  className,
  prefix,
}: {
  stats: HubResourceStats | null;
  className?: string;
  /** Optional lead-in, e.g. «На платформе» for the platform totals line. */
  prefix?: string;
}) {
  if (!stats) return null;
  if (
    stats.addedYesterday <= 0 &&
    stats.addedToday <= 0 &&
    stats.updatedToday <= 0 &&
    stats.total <= 0
  ) {
    return null;
  }

  const parts: { key: string; node: ReactNode }[] = [];
  if (prefix?.trim()) {
    parts.push({
      key: "prefix",
      node: <span className="font-medium text-white/70">{prefix.trim()}</span>,
    });
  }
  if (stats.total > 0) {
    parts.push({
      key: "total",
      node: (
        <>
          всего{" "}
          <span className="font-semibold tabular-nums text-white/90">
            {stats.total.toLocaleString("ru-RU")}
          </span>{" "}
          в каталоге
        </>
      ),
    });
  }
  if (stats.addedToday > 0) {
    parts.push({
      key: "today",
      node: (
        <>
          <span className="font-semibold tabular-nums text-brand-green">
            {formatDelta(stats.addedToday)}
          </span>{" "}
          сегодня
        </>
      ),
    });
  }
  if (stats.addedYesterday > 0) {
    parts.push({
      key: "yesterday",
      node: (
        <>
          <span className="font-semibold tabular-nums text-white/85">
            {formatDelta(stats.addedYesterday)}
          </span>{" "}
          вчера
        </>
      ),
    });
  }
  if (stats.updatedToday > 0) {
    parts.push({
      key: "updated",
      node: (
        <>
          <span className="font-semibold tabular-nums text-white/85">
            {formatDelta(stats.updatedToday)}
          </span>{" "}
          обновлений
        </>
      ),
    });
  }

  return (
    <p
      className={cn(
        "mt-2 text-[11px] leading-snug text-white/60 sm:mt-2.5 sm:text-xs",
        className,
      )}
    >
      {parts.map((part, i) => (
        <span key={part.key}>
          {i > 0 ? <span className="mx-1.5 text-white/35">·</span> : null}
          {part.node}
        </span>
      ))}
    </p>
  );
}
