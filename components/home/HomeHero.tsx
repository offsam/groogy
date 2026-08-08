"use client";

import Image from "next/image";
import { SearchBar } from "@/components/search/SearchBar";
import { HomeRegionActivityLine } from "@/components/home/HomeRegionStatsStrip";
import { RegionHubPicker } from "@/components/regions/RegionHubPicker";
import type { HubResourceStats } from "@/lib/platform/hub-resource-stats";
import type { RegionHub, RegionHubId } from "@/lib/regions/hubs";

type HomeHeroProps = {
  hub: RegionHub;
  hubs: RegionHub[];
  inLabel: string;
  regionStats?: HubResourceStats | null;
  geoPrompt?: boolean;
  geoLoading?: boolean;
  onAllowGeo?: () => void;
  onDismissGeo?: () => void;
  onChangeHubs?: (hubIds: RegionHubId[]) => void;
};

export function HomeHero({
  hub,
  hubs,
  inLabel,
  regionStats = null,
  geoPrompt = false,
  geoLoading = false,
  onAllowGeo,
  onDismissGeo,
  onChangeHubs,
}: HomeHeroProps) {
  return (
    <section className="home-hero relative isolate z-20 w-full">
      <div className="home-hero-photo relative min-h-[220px] w-full sm:min-h-0 sm:h-[260px] md:h-[280px] lg:h-[300px]">
        <Image
          alt={hub.panoramaAlt}
          className="object-cover object-[center_40%]"
          fill
          priority
          sizes="100vw"
          src={hub.panoramaUrl}
          unoptimized
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-r from-slate-950/80 via-slate-950/50 to-slate-950/30"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-slate-950/25 via-transparent to-slate-950/55"
        />
        {/* Soft horizon — photo dissolves into the map below */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-16 sm:h-20 md:h-24"
          style={{
            background:
              "linear-gradient(to bottom, transparent 0%, rgb(15 23 42 / 0.15) 45%, rgb(15 23 42 / 0.05) 70%, transparent 100%)",
          }}
        />

        <div className="relative z-[1] flex min-h-[220px] flex-col sm:absolute sm:inset-0 sm:min-h-0">
          <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col justify-center gap-3 px-4 py-3 sm:px-6 sm:py-4 lg:px-8 lg:py-5">
            <div className="flex min-w-0 items-start gap-2.5">
              <div aria-hidden className="hidden size-9 shrink-0 sm:block" />
              <div className="min-w-0 w-full max-w-xl">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <h1 className="font-[family-name:var(--font-display)] text-[1.35rem] font-semibold leading-tight tracking-tight text-white sm:text-2xl md:text-3xl">
                    в {inLabel}
                  </h1>

                  {onChangeHubs ? (
                    <RegionHubPicker
                      onChange={onChangeHubs}
                      selected={hubs}
                      trigger={({ open, toggle }) => (
                        <button
                          aria-expanded={open}
                          aria-haspopup="listbox"
                          className="translate-y-[-1px] text-xs font-medium text-white/65 underline decoration-white/30 underline-offset-2 transition hover:text-white sm:text-[13px]"
                          onClick={toggle}
                          type="button"
                        >
                          Изменить
                        </button>
                      )}
                      variant="dark"
                    />
                  ) : null}
                </div>

                <HomeRegionActivityLine stats={regionStats} />

                <div className="home-hero-search mt-3 w-full sm:mt-3.5">
                  <SearchBar variant="hero" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {geoPrompt ? (
        <div className="relative z-10 border-t border-white/10 bg-slate-900/90 px-4 py-3 text-sm text-white backdrop-blur-md">
          <div className="mx-auto flex max-w-[1400px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <p className="text-white/85">
              Разрешить геолокацию, чтобы подобрать ближайший район?
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                className="rounded-lg bg-brand-yellow px-3 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-brand-yellow/90 disabled:opacity-60"
                disabled={geoLoading}
                onClick={onAllowGeo}
                type="button"
              >
                {geoLoading ? "Определяем…" : "Разрешить"}
              </button>
              <button
                className="rounded-lg px-3 py-1.5 text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
                onClick={onDismissGeo}
                type="button"
              >
                Не сейчас
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
