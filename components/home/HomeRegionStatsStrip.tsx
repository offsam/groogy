"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { HubResourceStats } from "@/lib/platform/hub-resource-stats";
import type { PlatformSectionKey } from "@/lib/platform/sections";
import { cn } from "@/lib/utils";

/** Refetch on tab focus only if last success was older than this. */
const STATS_STALE_MS = 60_000;

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
  churches: "churches",
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
  const lastFetchAtRef = useRef<number>(initial ? Date.now() : 0);
  const hubIdRef = useRef(hubId);
  hubIdRef.current = hubId;

  useEffect(() => {
    if (initial && ssrHubId && hubId === ssrHubId) {
      setStats(initial);
      lastFetchAtRef.current = Date.now();
    }
  }, [initial, hubId, ssrHubId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Bypass CDN/browser cache — hub totals change after import/archive.
        const res = await fetch(
          `/api/hub-resource-stats?hub=${encodeURIComponent(hubId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as HubResourceStats;
        if (!cancelled && Array.isArray(data.cards)) {
          setStats(data);
          lastFetchAtRef.current = Date.now();
        }
      } catch {
        // keep last (including SSR)
      }
    }

    // Always refresh on hub change / mount so SSR stale counts (e.g. 349)
    // cannot stick after catalog migrations.
    void load();

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (hubIdRef.current !== hubId) return;
      if (Date.now() - lastFetchAtRef.current < STATS_STALE_MS) return;
      void load();
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hubId, initial, ssrHubId]);

  return stats;
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function cardCount(stats: HubResourceStats, key: string): number {
  return stats.cards.find((c) => c.key === key)?.count ?? 0;
}

/** Compact region totals under «в {region}» on the hero photo. */
export function HomeRegionActivityLine({
  stats,
  className,
}: {
  stats: HubResourceStats | null;
  className?: string;
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
  if (stats.total > 0) {
    parts.push({
      key: "total",
      node: (
        <>
          уже{" "}
          <span className="font-semibold tabular-nums text-white/90">
            {stats.total.toLocaleString("ru-RU")}
          </span>{" "}
          {pluralRu(stats.total, "карточка", "карточки", "карточек")}
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

/** Platform totals under the AI search: «В Кругах уже …». */
export function HomePlatformActivityLine({
  stats,
  className,
}: {
  stats: HubResourceStats | null;
  className?: string;
}) {
  if (!stats) return null;

  const businesses = cardCount(stats, "businesses");
  const professionals = cardCount(stats, "professionals");
  const members = stats.members ?? 0;

  if (
    stats.total <= 0 &&
    stats.addedYesterday <= 0 &&
    members <= 0 &&
    businesses <= 0 &&
    professionals <= 0
  ) {
    return null;
  }

  const parts: { key: string; node: ReactNode }[] = [
    {
      key: "prefix",
      node: <span className="font-medium text-white/70">В Кругах уже</span>,
    },
  ];

  if (stats.total > 0) {
    parts.push({
      key: "total",
      node: (
        <>
          в каталоге{" "}
          <span className="font-semibold tabular-nums text-white/90">
            {stats.total.toLocaleString("ru-RU")}
          </span>
        </>
      ),
    });
  }
  if (stats.addedYesterday > 0) {
    parts.push({
      key: "yesterday",
      node: (
        <>
          добавлено вчера{" "}
          <span className="font-semibold tabular-nums text-white/85">
            {stats.addedYesterday.toLocaleString("ru-RU")}
          </span>
        </>
      ),
    });
  }
  if (members > 0) {
    parts.push({
      key: "members",
      node: (
        <>
          <span className="font-semibold tabular-nums text-white/90">
            {members.toLocaleString("ru-RU")}
          </span>{" "}
          {pluralRu(members, "пользователь", "пользователя", "пользователей")}
        </>
      ),
    });
  }
  if (businesses > 0) {
    parts.push({
      key: "businesses",
      node: (
        <>
          <span className="font-semibold tabular-nums text-white/90">
            {businesses.toLocaleString("ru-RU")}
          </span>{" "}
          {pluralRu(businesses, "бизнес", "бизнеса", "бизнесов")}
        </>
      ),
    });
  }
  if (professionals > 0) {
    parts.push({
      key: "professionals",
      node: (
        <>
          <span className="font-semibold tabular-nums text-white/90">
            {professionals.toLocaleString("ru-RU")}
          </span>{" "}
          {pluralRu(
            professionals,
            "профессионал",
            "профессионала",
            "профессионалов",
          )}
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
