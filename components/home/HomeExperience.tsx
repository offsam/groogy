"use client";

import { useMemo } from "react";
import Link from "next/link";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeActivityMap } from "@/components/home/HomeActivityMap";
import { useHomeRegion } from "@/components/home/useHomeRegion";
import { PopularResourcesSection } from "@/components/home/PopularResourcesSection";
import {
  sectionStatFromHub,
  useHubRegionStats,
} from "@/components/home/HomeRegionStatsStrip";
import { ErrorState } from "@/components/ui/DataState";
import { KrugiPinIcon } from "@/components/brand/KrugiPinIcon";
import type { HubResourceStats } from "@/lib/platform/hub-resource-stats";
import { PLATFORM_SECTIONS } from "@/lib/platform/sections";
import type { PopularHomeItem } from "@/lib/platform/popular-resources";
import type { HomeMapPin } from "@/lib/supabase/queries";
import type { RegionHub } from "@/lib/regions/hubs";
import { withHubParam } from "@/lib/regions/hubs";

type HomeExperienceProps = {
  lockedFromProfile: boolean;
  initialHub: RegionHub;
  initialInLabel: string;
  initialCountyGeoid: string | null;
  initialRegionStats: HubResourceStats | null;
  initialPlatformStats: HubResourceStats | null;
  popularFeed: PopularHomeItem[];
  mapPins: HomeMapPin[];
  error: string | null;
};

export function HomeExperience({
  lockedFromProfile,
  initialHub,
  initialInLabel,
  initialCountyGeoid,
  initialRegionStats,
  initialPlatformStats,
  popularFeed,
  mapPins,
  error,
}: HomeExperienceProps) {
  const { region, hubIdsParam, geoStatus, requestGeolocation, dismissGeoPrompt, setHubs } =
    useHomeRegion({
      lockedFromProfile,
      initialHub,
      initialInLabel,
      initialCountyGeoid,
    });

  const regionStats = useHubRegionStats(
    hubIdsParam,
    initialRegionStats,
    initialHub.id,
  );

  const platformStats = useHubRegionStats(
    "all",
    initialPlatformStats,
    "all",
  );

  const directoryPins = useMemo(
    () =>
      PLATFORM_SECTIONS.map((item) => ({
        key: item.key,
        title: item.title,
        pin: item.pin,
        href: withHubParam(item.href, hubIdsParam),
        stats: sectionStatFromHub(regionStats, item.key),
      })),
    [hubIdsParam, regionStats],
  );

  return (
    <div className="home-fullwidth w-full">
      <HomeHero
        geoLoading={geoStatus === "loading"}
        geoPrompt={geoStatus === "prompt" || geoStatus === "loading"}
        hub={region.hub}
        hubs={region.hubs}
        inLabel={region.inLabel}
        platformStats={platformStats}
        regionStats={regionStats}
        onAllowGeo={requestGeolocation}
        onDismissGeo={dismissGeoPrompt}
        onChangeHubs={setHubs}
      />

      <HomeActivityMap
        hub={region.hub}
        hubs={region.hubs}
        pins={mapPins}
      />

      <section className="relative z-30 mx-auto max-w-[1400px] px-3 pb-6 pt-4 sm:px-6 sm:pb-8 sm:pt-6 lg:px-8">
        <div className="mb-4 flex items-center justify-between gap-3 sm:mb-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
            Разделы
          </p>
          <Link
            className="text-[11px] font-medium text-slate-500 transition hover:text-slate-800 sm:text-xs"
            href={withHubParam("/search", hubIdsParam)}
          >
            Смотреть все
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-5 lg:gap-5">
          {directoryPins.map((item) => (
            <Link
              key={item.key}
              className="group flex min-w-0 items-start gap-2.5 sm:gap-3"
              href={item.href}
            >
              <KrugiPinIcon
                className="size-12 shrink-0 transition group-hover:-translate-y-0.5 sm:size-[3.75rem]"
                name={item.pin}
              />
              <div className="min-w-0 pt-0.5">
                <p className="truncate text-[13px] font-semibold leading-tight text-slate-800 sm:text-sm">
                  {item.title}
                </p>
                {item.stats ? (
                  <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                    <span className="font-[family-name:var(--font-display)] text-sm font-semibold tabular-nums leading-none text-slate-900 sm:text-[15px]">
                      {item.stats.count.toLocaleString("ru-RU")}
                    </span>
                    {item.stats.addedToday > 0 ? (
                      <span className="text-[11px] font-semibold tabular-nums leading-none text-brand-green sm:text-xs">
                        +{item.stats.addedToday.toLocaleString("ru-RU")}
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {error ? (
        <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
          <ErrorState detail={error} message="Не удалось загрузить каталог" />
        </div>
      ) : (
        <PopularResourcesSection
          hubIdsParam={hubIdsParam}
          initialHubId={initialHub.id}
          items={popularFeed}
        />
      )}

      <section className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto grid max-w-[1400px] gap-6 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
          {[
            {
              title: "Проверенные компании",
              text: "Карточки проходят модерацию перед публикацией.",
            },
            {
              title: "Живые отзывы",
              text: "Рейтинги и отзывы сообщества КРУГИ.",
            },
            {
              title: "Контакты по запросу",
              text: "Телефон и адрес открываются осознанно.",
            },
            {
              title: "Локальные круги",
              text: "Регион по ZIP или геолокации — от OC до NY и Oregon.",
            },
          ].map((item) => (
            <div key={item.title}>
              <h3 className="font-semibold text-slate-900">{item.title}</h3>
              <p className="mt-1 text-sm text-slate-500">{item.text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
