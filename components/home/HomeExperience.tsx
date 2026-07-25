"use client";

import { useMemo } from "react";
import Link from "next/link";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeActivityMap } from "@/components/home/HomeActivityMap";
import { useHomeRegion } from "@/components/home/useHomeRegion";
import { PopularResourcesSection } from "@/components/home/PopularResourcesSection";
import { ErrorState } from "@/components/ui/DataState";
import {
  KrugiPinIcon,
  type KrugiPinName,
} from "@/components/brand/KrugiPinIcon";
import type { PopularHomeItem } from "@/lib/platform/popular-resources";
import type { Business } from "@/types/business";
import type { RegionHub } from "@/lib/regions/hubs";
import { withHubParam } from "@/lib/regions/hubs";

type HomeExperienceProps = {
  lockedFromProfile: boolean;
  initialHub: RegionHub;
  initialInLabel: string;
  initialCountyGeoid: string | null;
  popularFeed: PopularHomeItem[];
  newest: Business[];
  popular: Business[];
  error: string | null;
};

/** Eight main hubs under the map — sheet icons, our product labels. */
const PLATFORM_PINS: {
  href: string;
  title: string;
  pin: KrugiPinName;
}[] = [
  { href: "/search", title: "Бизнесы", pin: "businesses" },
  { href: "/marketplace", title: "Marketplace", pin: "listings" },
  { href: "/services", title: "Услуги", pin: "services" },
  { href: "/lechu", title: "Лечу", pin: "lechu" },
  { href: "/transfers", title: "Переводы", pin: "transfers" },
  { href: "/search?category=restaurants", title: "Еда", pin: "food" },
  { href: "/search?category=auto", title: "Авто", pin: "auto" },
  { href: "/search?q=работа", title: "Работа", pin: "jobs" },
];

export function HomeExperience({
  lockedFromProfile,
  initialHub,
  initialInLabel,
  initialCountyGeoid,
  popularFeed,
  newest,
  popular,
  error,
}: HomeExperienceProps) {
  const { region, hubIdsParam, geoStatus, requestGeolocation, dismissGeoPrompt, setHubs } =
    useHomeRegion({
      lockedFromProfile,
      initialHub,
      initialInLabel,
      initialCountyGeoid,
    });

  const directoryPins = useMemo(
    () =>
      PLATFORM_PINS.map((item) => ({
        key: `p-${item.pin}`,
        ...item,
        href: withHubParam(item.href, hubIdsParam),
      })),
    [hubIdsParam],
  );

  return (
    <div className="home-fullwidth w-full">
      <HomeHero
        geoLoading={geoStatus === "loading"}
        geoPrompt={geoStatus === "prompt" || geoStatus === "loading"}
        hub={region.hub}
        hubIdsParam={hubIdsParam}
        hubs={region.hubs}
        inLabel={region.inLabel}
        onAllowGeo={requestGeolocation}
        onDismissGeo={dismissGeoPrompt}
        onChangeHubs={setHubs}
      />

      <HomeActivityMap
        hub={region.hub}
        hubs={region.hubs}
        newest={newest}
        popular={popular}
      />

      <section className="relative z-30 mx-auto max-w-[1400px] px-3 pb-6 pt-2 sm:-mt-24 sm:px-6 sm:pb-8 sm:pt-0 lg:px-8">
        <div className="grid grid-cols-4 gap-x-2 gap-y-4 sm:flex sm:flex-wrap sm:justify-center sm:gap-x-7 sm:gap-y-6">
          {directoryPins.map((item) => (
            <Link
              key={item.key}
              className="group flex w-full flex-col items-center gap-1 text-center sm:w-[6.25rem] sm:gap-1.5"
              href={item.href}
            >
              <KrugiPinIcon
                className="size-12 transition group-hover:-translate-y-0.5 sm:size-[4.2rem]"
                name={item.pin}
              />
              <span className="text-[10px] font-medium leading-tight text-slate-700 sm:text-xs">
                {item.title}
              </span>
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
