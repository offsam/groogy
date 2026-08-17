"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Map as MapIcon } from "lucide-react";
import type { RegionHub } from "@/lib/regions/hubs";
import {
  isStateHub,
  locationFieldsMatchHub,
  mergeHubsForMap,
  zoomToFitBounds,
} from "@/lib/regions/hubs";
import { MapAttribution } from "@/components/map/MapAttribution";
import type { HomeMapPin } from "@/lib/supabase/queries";
import { cn } from "@/lib/utils";

type HomeActivityMapProps = {
  hub: RegionHub;
  hubs?: RegionHub[];
  /** Guest without region/geo — show continental USA camera + all hub pins. */
  nationalOverview?: boolean;
  pins?: HomeMapPin[];
};

const HomeActivityMapCanvas = dynamic(
  () => import("@/components/home/HomeActivityMapCanvas"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-slate-200/70 text-sm text-slate-400">
        Загрузка карты…
      </div>
    ),
  },
);

function inSelectedHubs(pin: HomeMapPin, hubs: readonly RegionHub[]): boolean {
  return hubs.some((hub) =>
    locationFieldsMatchHub(
      {
        city: pin.city,
        latitude: pin.latitude,
        longitude: pin.longitude,
        state_code: pin.stateCode,
      },
      hub,
    ),
  );
}

export function HomeActivityMap({
  hub,
  hubs,
  nationalOverview = false,
  pins = [],
}: HomeActivityMapProps) {
  const [selectedPin, setSelectedPin] = useState<HomeMapPin | null>(null);
  const [cardPoint, setCardPoint] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [nationalPins, setNationalPins] = useState<HomeMapPin[] | null>(null);
  const selectedHubs = hubs && hubs.length > 0 ? hubs : [hub];
  const hubsKey = nationalOverview
    ? "usa-overview"
    : selectedHubs.map((h) => h.id).join(",");
  const multiRegion = !nationalOverview && selectedHubs.length >= 2;
  const wideRegion = !nationalOverview && selectedHubs.length >= 3;

  const needsNationwidePins =
    nationalOverview || selectedHubs.some((h) => isStateHub(h));

  // SSR ships metro hub pins; USA / whole-state views need the full catalog.
  useEffect(() => {
    if (!needsNationwidePins || nationalPins) return;
    let cancelled = false;
    fetch("/api/home-map-pins")
      .then((res) => (res.ok ? res.json() : { pins: [] }))
      .then((data: { pins?: HomeMapPin[] }) => {
        if (!cancelled) setNationalPins(data.pins ?? []);
      })
      .catch(() => {
        if (!cancelled) setNationalPins([]);
      });
    return () => {
      cancelled = true;
    };
  }, [needsNationwidePins, nationalPins]);

  const mergedHub = useMemo(
    () => (nationalOverview ? hub : mergeHubsForMap(selectedHubs)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hubsKey captures selection
    [hubsKey, nationalOverview],
  );

  const mapHub = useMemo(() => {
    if (nationalOverview || selectedHubs.length < 2) return mergedHub;
    const mapZoom = zoomToFitBounds(
      mergedHub.mapBounds,
      { width: 1200, height: 640 },
      { paddingRatio: 0.05, fit: "cover" },
    );
    if (Math.abs(mapZoom - mergedHub.mapZoom) < 0.05) return mergedHub;
    return { ...mergedHub, mapZoom };
  }, [mergedHub, nationalOverview, selectedHubs.length]);

  const hubPins = useMemo(() => {
    if (!needsNationwidePins) {
      return pins.filter((p) => inSelectedHubs(p, selectedHubs));
    }
    // Wait for the full nationwide set — otherwise zoomed-out state circles
    // only reflect the SSR metro slice and look like a broken total.
    if (!nationalPins) return [];
    const byKey = new Map<string, HomeMapPin>();
    for (const pin of [...pins, ...nationalPins]) {
      byKey.set(`${pin.kind}:${pin.id}`, pin);
    }
    const merged = [...byKey.values()];
    if (nationalOverview) return merged;
    return merged.filter((p) => inSelectedHubs(p, selectedHubs));
  }, [needsNationwidePins, nationalOverview, nationalPins, pins, selectedHubs]);
  const selectedInHub =
    selectedPin && hubPins.some((p) => p.id === selectedPin.id)
      ? selectedPin
      : null;

  const onSelect = useCallback((pin: HomeMapPin | null) => {
    setSelectedPin(pin);
    if (!pin) setCardPoint(null);
  }, []);

  return (
    <section className="home-map-from-hero relative z-10 w-full overflow-x-hidden pb-0 pt-0">
      <div className="relative mx-auto w-full max-w-[1600px] px-0">
        <div
          className={cn(
            "relative w-full",
            wideRegion
              ? "pb-[78%] sm:pb-[64%]"
              : multiRegion
                ? "pb-[68%] sm:pb-[56%]"
                : "pb-[50%] sm:pb-[40.909%]",
          )}
        >
          <div className="home-map-from-hero__frame absolute inset-0 overflow-hidden">
            <HomeActivityMapCanvas
              key={hubsKey}
              cardPoint={selectedInHub ? cardPoint : null}
              hub={mapHub}
              onCardPoint={setCardPoint}
              onSelect={onSelect}
              pins={hubPins}
              selectedPin={selectedInHub}
            />

            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-[400]"
              style={{
                background: `
                  linear-gradient(to right, var(--background) 0%, transparent 1.5%, transparent 98.5%, var(--background) 100%)
                `,
              }}
            />

            {/* Soft blend into page background — map doesn't cut off hard */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 z-[450] h-14 sm:h-16"
              style={{
                background:
                  "linear-gradient(to bottom, transparent 0%, color-mix(in srgb, var(--background) 55%, transparent) 50%, var(--background) 100%)",
              }}
            />

            <MapAttribution
              className={cn(
                "pointer-events-auto absolute right-2.5 top-2.5 z-[500] max-w-[min(100%,12rem)]",
                "text-right text-[9px] leading-tight text-slate-600/70 sm:right-3.5 sm:top-3.5 sm:text-[10px]",
                "drop-shadow-[0_1px_1px_rgba(255,255,255,0.85)]",
                "[&_a]:text-slate-600/70 [&_a]:no-underline [&_a:hover]:text-slate-800 [&_a:hover]:underline",
              )}
            />

            <Link
              aria-label="Открыть карту США"
              className={cn(
                "pointer-events-auto absolute bottom-2 left-1/2 z-[500] -translate-x-1/2",
                "inline-flex items-center gap-1.5 rounded-full",
                "border border-white/70 bg-white/65 px-2.5 py-1.5",
                "shadow-[0_6px_18px_rgba(15,23,42,0.10)] backdrop-blur-md",
                "transition hover:-translate-y-0.5 hover:bg-white/80",
                "sm:bottom-2.5",
              )}
              href="/map"
            >
              <MapIcon
                aria-hidden
                className="size-4 text-brand-blue"
                strokeWidth={1.75}
              />
              <span className="text-[11px] font-semibold tracking-tight text-slate-700 sm:text-xs">
                США
              </span>
            </Link>

            {hubPins.length === 0 && !nationalOverview ? (
              <div className="pointer-events-none absolute inset-x-4 bottom-10 z-[500] rounded-lg bg-white/95 px-3 py-2 text-center text-sm text-slate-600 shadow-sm sm:bottom-8 sm:left-auto sm:right-4 sm:max-w-xs">
                В этом регионе пока нет адресов на карте
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
