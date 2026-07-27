"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { RegionHub } from "@/lib/regions/hubs";
import {
  isLatLngInHubBounds,
  mergeHubsForMap,
  zoomToFitBounds,
} from "@/lib/regions/hubs";
import { MapAttribution } from "@/components/map/MapAttribution";
import type { HomeMapPin } from "@/lib/supabase/queries";
import { cn } from "@/lib/utils";

type HomeActivityMapProps = {
  hub: RegionHub;
  hubs?: RegionHub[];
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
    isLatLngInHubBounds(pin.latitude, pin.longitude, hub),
  );
}

export function HomeActivityMap({
  hub,
  hubs,
  pins = [],
}: HomeActivityMapProps) {
  const [selectedPin, setSelectedPin] = useState<HomeMapPin | null>(null);
  const [cardPoint, setCardPoint] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const selectedHubs = hubs && hubs.length > 0 ? hubs : [hub];
  const hubsKey = selectedHubs.map((h) => h.id).join(",");
  const multiRegion = selectedHubs.length >= 2;
  const wideRegion = selectedHubs.length >= 3;

  const mergedHub = useMemo(
    () => mergeHubsForMap(selectedHubs),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hubsKey captures selection
    [hubsKey],
  );

  const mapHub = useMemo(() => {
    if (selectedHubs.length < 2) return mergedHub;
    const mapZoom = zoomToFitBounds(
      mergedHub.mapBounds,
      { width: 1200, height: 640 },
      { paddingRatio: 0.05, fit: "cover" },
    );
    if (Math.abs(mapZoom - mergedHub.mapZoom) < 0.05) return mergedHub;
    return { ...mergedHub, mapZoom };
  }, [mergedHub, selectedHubs.length]);

  const hubPins = useMemo(
    () => pins.filter((p) => inSelectedHubs(p, selectedHubs)),
    [pins, selectedHubs],
  );

  const selectedInHub =
    selectedPin && hubPins.some((p) => p.id === selectedPin.id)
      ? selectedPin
      : null;

  const onSelect = useCallback((pin: HomeMapPin | null) => {
    setSelectedPin(pin);
    if (!pin) setCardPoint(null);
  }, []);

  return (
    <section className="relative w-full overflow-x-hidden pb-0 pt-0">
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
          <div className="absolute inset-0 overflow-hidden">
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
                  linear-gradient(to bottom, var(--background) 0%, transparent 1.25rem),
                  linear-gradient(to right, var(--background) 0%, transparent 1.5%, transparent 98.5%, var(--background) 100%),
                  linear-gradient(to bottom, transparent 90%, var(--background) 100%)
                `,
              }}
            />

            {hubPins.length === 0 ? (
              <div className="pointer-events-none absolute inset-x-4 bottom-6 z-[500] rounded-lg bg-white/95 px-3 py-2 text-center text-sm text-slate-600 shadow-sm">
                В этом регионе пока нет адресов на карте
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 z-20 hidden sm:block">
        <div className="mx-auto flex h-full max-w-[1600px] items-center justify-start px-6 lg:px-10">
          <Link
            className="pointer-events-auto rounded-full border border-white/70 bg-white/80 px-6 py-3 text-base font-semibold text-slate-800 shadow-[0_10px_28px_rgba(15,23,42,0.14)] backdrop-blur-sm transition hover:-translate-y-0.5 hover:bg-white/90 hover:shadow-[0_14px_32px_rgba(15,23,42,0.18)]"
            href="/map"
          >
            Смотреть всю карту
          </Link>
        </div>
      </div>

      <div className="relative z-20 mx-auto flex max-w-[1600px] flex-col items-center gap-2 px-4 pb-3 pt-1 sm:px-6 lg:px-10">
        <Link
          className="inline-flex rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 sm:hidden"
          href="/map"
        >
          Смотреть всю карту
        </Link>
        <MapAttribution className="pointer-events-auto w-full text-center text-[10px] text-slate-400 sm:text-right" />
      </div>
    </section>
  );
}
