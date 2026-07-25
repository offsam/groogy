"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { HubCategoryCounts } from "@/lib/platform/hub-category-counts";
import { PLATFORM_SECTIONS } from "@/lib/platform/sections";
import { withHubParam } from "@/lib/regions/hubs";
import { cn } from "@/lib/utils";

type HomeHubCategoryCountsProps = {
  hubId: string;
  initial?: HubCategoryCounts | null;
  /** Overlay on the hero panorama (default). */
  variant?: "hero" | "strip";
  className?: string;
};

function formatCount(n: number) {
  return n.toLocaleString("ru-RU");
}

function pluralRu(n: number, one: string, few: string, many: string) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function totalOf(counts: HubCategoryCounts) {
  return PLATFORM_SECTIONS.reduce((sum, item) => sum + counts[item.key], 0);
}

export function HomeHubCategoryCounts({
  hubId,
  initial = null,
  variant = "hero",
  className,
}: HomeHubCategoryCountsProps) {
  const [counts, setCounts] = useState<HubCategoryCounts | null>(initial);
  const [loading, setLoading] = useState(!initial);

  useEffect(() => {
    if (initial) {
      setCounts(initial);
      setLoading(false);
    }
  }, [initial]);

  useEffect(() => {
    // SSR already filled this hub — skip mount refetch (no "—" flash).
    if (initial) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/hub-category-counts?hub=${encodeURIComponent(hubId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as HubCategoryCounts;
        if (!cancelled && typeof data.businesses === "number") {
          setCounts(data);
        }
      } catch {
        // keep last
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [hubId, initial]);

  if (variant === "strip") {
    if (!counts && loading) {
      return (
        <div className="border-b border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-[1400px] px-4 py-1.5 sm:px-6 lg:px-8">
            <p className="text-xs text-slate-400 sm:text-sm">Считаем по району…</p>
          </div>
        </div>
      );
    }
    if (!counts) return null;
    return (
      <div className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-[1400px] px-4 py-1.5 sm:px-6 lg:px-8">
          <p className="flex flex-nowrap items-center overflow-x-auto whitespace-nowrap text-xs text-slate-600 sm:text-sm">
            {PLATFORM_SECTIONS.map((item, index) => {
              const value = counts[item.key];
              return (
                <span key={item.key} className="inline-flex shrink-0 items-center">
                  {index > 0 ? (
                    <span className="mx-1.5 text-slate-300" aria-hidden>
                      ·
                    </span>
                  ) : null}
                  <Link
                    className="tabular-nums transition hover:text-slate-900"
                    href={withHubParam(item.href, hubId)}
                  >
                    <span className="font-semibold text-slate-900">
                      {formatCount(value)}
                    </span>{" "}
                    <span className="text-slate-600">{item.title}</span>
                  </Link>
                </span>
              );
            })}
          </p>
        </div>
      </div>
    );
  }

  const total = counts ? totalOf(counts) : 0;

  return (
    <div
      className={cn(
        "relative z-10 sm:pointer-events-none sm:absolute sm:inset-x-0 sm:bottom-0",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-24 bg-gradient-to-t from-slate-950/85 via-slate-950/40 to-transparent sm:block sm:h-28"
      />

      <div className="relative mx-auto max-w-[1400px] px-3 pb-3 pt-1 sm:px-6 sm:pb-3 sm:pt-7 lg:px-8">
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-0.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/55">
            В районе
          </p>
          {counts ? (
            <p className="text-[11px] tabular-nums text-white/50">
              <span className="font-semibold text-white/85">
                {formatCount(total)}
              </span>{" "}
              всего
            </p>
          ) : (
            <p className="text-[11px] text-white/40">
              {loading ? "Считаем…" : ""}
            </p>
          )}
        </div>

        <div
          aria-label="Сводка по разделам"
          className="pointer-events-auto -mx-0.5 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-2"
        >
          {PLATFORM_SECTIONS.map((item, index) => {
            const value = counts?.[item.key];
            const ready = typeof value === "number";
            const unit = ready
              ? pluralRu(value, item.unitOne, item.unitFew, item.unitMany)
              : item.unitMany;

            return (
              <Link
                key={item.key}
                className={cn(
                  "group relative flex min-w-[7.75rem] shrink-0 flex-col gap-0.5 rounded-2xl border border-white/15 bg-white/10 px-2.5 py-2 text-left shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-md transition sm:min-w-[8.25rem] sm:max-w-[10rem] sm:justify-between sm:gap-1",
                  "hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/18",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-yellow",
                  "motion-safe:animate-[hubCountIn_420ms_ease-out_both]",
                )}
                href={withHubParam(item.href, hubId)}
                style={{ animationDelay: `${index * 45}ms` }}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide text-white/55">
                  {item.title}
                </span>

                <div className="min-w-0">
                  <p
                    className={cn(
                      "font-[family-name:var(--font-display)] text-lg font-semibold leading-none tabular-nums text-white sm:text-2xl",
                      !ready && "text-white/35",
                    )}
                  >
                    {ready ? formatCount(value) : "—"}
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium leading-tight text-white/75">
                    {unit}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
