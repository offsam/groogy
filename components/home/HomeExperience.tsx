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
import { isUsaOverviewHub, withHubParam } from "@/lib/regions/hubs";

type HomeExperienceProps = {
  lockedFromProfile: boolean;
  initialHub: RegionHub;
  initialInLabel: string;
  initialCountyGeoid: string | null;
  initialRegionStats: HubResourceStats | null;
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
  popularFeed,
  mapPins,
  error,
}: HomeExperienceProps) {
  const {
    region,
    hubIdsParam,
    nationalOverview,
    geoStatus,
    requestGeolocation,
    dismissGeoPrompt,
    setHubs,
  } = useHomeRegion({
    lockedFromProfile,
    initialHub,
    initialInLabel,
    initialCountyGeoid,
  });

  const statsHubKey = nationalOverview ? "all" : hubIdsParam;
  const ssrStatsHubKey = isUsaOverviewHub(initialHub) ? "all" : initialHub.id;

  const regionStats = useHubRegionStats(
    statsHubKey,
    initialRegionStats,
    ssrStatsHubKey,
  );

  const directoryPins = useMemo(
    () =>
      PLATFORM_SECTIONS.map((item) => ({
        key: item.key,
        title: item.title,
        pin: item.pin,
        href:
          nationalOverview
            ? withHubParam(item.href, "usa-overview")
            : hubIdsParam
              ? withHubParam(item.href, hubIdsParam)
              : item.href,
        stats: sectionStatFromHub(regionStats, item.key),
      })),
    [hubIdsParam, nationalOverview, regionStats],
  );

  return (
    <div className="home-fullwidth w-full">
      <HomeHero
        geoLoading={geoStatus === "loading"}
        geoPrompt={geoStatus === "prompt" || geoStatus === "loading"}
        hub={region.hub}
        hubs={region.hubs}
        inLabel={region.inLabel}
        regionStats={regionStats}
        onAllowGeo={requestGeolocation}
        onDismissGeo={dismissGeoPrompt}
        onChangeHubs={setHubs}
      />

      <HomeActivityMap
        hub={region.hub}
        hubs={region.hubs}
        nationalOverview={nationalOverview}
        pins={mapPins}
      />

      <section className="relative z-30 mx-auto max-w-[1400px] px-3 pb-6 pt-4 sm:px-6 sm:pb-8 sm:pt-6 lg:px-8">
        <div className="mx-auto grid max-w-lg grid-cols-3 gap-x-3 gap-y-5 sm:max-w-xl sm:gap-x-5 sm:gap-y-6 md:max-w-2xl md:gap-x-8">
          {directoryPins.map((item) => (
            <Link
              key={item.key}
              className="group flex min-w-0 flex-col items-center gap-2 text-center"
              href={item.href}
            >
              <KrugiPinIcon
                className="size-[4.25rem] transition group-hover:-translate-y-0.5 sm:size-[4.75rem]"
                name={item.pin}
              />
              <div className="min-w-0 w-full">
                <p className="text-[12px] font-semibold leading-tight text-slate-800 sm:text-[13px]">
                  {item.title}
                </p>
                {item.stats ? (
                  <p className="mt-0.5 flex flex-wrap items-baseline justify-center gap-x-1 gap-y-0.5">
                    <span className="font-[family-name:var(--font-display)] text-[11px] font-semibold tabular-nums leading-none text-slate-500 sm:text-xs">
                      {item.stats.count.toLocaleString("ru-RU")}
                    </span>
                    {item.stats.addedToday > 0 ? (
                      <span className="text-[10px] font-semibold tabular-nums leading-none text-brand-green sm:text-[11px]">
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
          initialHubId={isUsaOverviewHub(initialHub) ? "" : initialHub.id}
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
