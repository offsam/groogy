"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import L from "leaflet";
import {
  AttributionControl,
  MapContainer,
  Marker,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import { ArrowLeft } from "lucide-react";
import { FitBounds } from "@/components/map/FitBounds";
import { MAP_ATTRIBUTION_CONTROL, OSM_ATTRIBUTION, OSM_TILE_URL } from "@/lib/map/tiles";
import { hasCoordinates, type Business } from "@/types/business";

const OC_CENTER: [number, number] = [33.66, -117.78];

function createPinIcon(selected: boolean) {
  return L.divIcon({
    className: "",
    html: `<div class="marker-pin${selected ? " marker-pin--active" : ""}"></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 28],
    tooltipAnchor: [0, -26],
  });
}

function ResizeHandler() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() =>
      map.invalidateSize({ animate: false }),
    );
    observer.observe(map.getContainer());
    const t = window.setTimeout(
      () => map.invalidateSize({ animate: false }),
      120,
    );
    return () => {
      observer.disconnect();
      window.clearTimeout(t);
    };
  }, [map]);
  return null;
}

function hasStreetAddress(b: Business): boolean {
  const address = b.addressLine?.trim() ?? "";
  if (!address) return false;
  if (b.locationPrecision === "county") return false;
  return true;
}

type FullPlatformMapProps = {
  businesses: Business[];
};

export default function FullPlatformMap({ businesses }: FullPlatformMapProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Only real addresses — no county blobs
  const mappable = useMemo(
    () => businesses.filter(hasCoordinates).filter(hasStreetAddress),
    [businesses],
  );

  const fitPoints = useMemo(
    () => mappable.map((b) => [b.latitude, b.longitude] as [number, number]),
    [mappable],
  );

  const selected = mappable.find((b) => b.id === selectedId) ?? null;

  return (
    <div className="relative h-[calc(100dvh-5.5rem)] w-full min-h-[480px]">
      <div className="absolute inset-x-0 top-0 z-[1000] border-b border-slate-200/80 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-slate-400"
              href="/"
            >
              <ArrowLeft aria-hidden className="size-4" />
              На главную
            </Link>
            <p className="truncate text-sm text-slate-600">
              На карте{" "}
              <span className="font-semibold text-slate-900">
                {mappable.length}
              </span>{" "}
              {mappable.length === 1
                ? "бизнес с адресом"
                : "бизнесов с адресами"}
            </p>
          </div>
          {selected ? (
            <Link
              className="shrink-0 rounded-full bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              href={`/business/${selected.slug}`}
            >
              Открыть карточку
            </Link>
          ) : null}
        </div>
      </div>

      <MapContainer
        attributionControl={false}
        center={OC_CENTER}
        className="h-full w-full"
        scrollWheelZoom
        zoom={10}
        zoomSnap={0}
      >
        <AttributionControl {...MAP_ATTRIBUTION_CONTROL} />
        <TileLayer attribution={OSM_ATTRIBUTION} url={OSM_TILE_URL} />
        <ResizeHandler />
        <FitBounds points={fitPoints} />
        {mappable.map((business) => {
          const selectedPin = business.id === selectedId;
          const place =
            [business.addressLine, business.city].filter(Boolean).join(", ") ||
            "Адрес уточняется";

          return (
            <Marker
              key={business.id}
              eventHandlers={{ click: () => setSelectedId(business.id) }}
              icon={createPinIcon(selectedPin)}
              position={[business.latitude, business.longitude]}
              zIndexOffset={selectedPin ? 1000 : 0}
            >
              <Tooltip direction="top">
                <span className="text-sm font-medium">
                  {business.name}
                  <span className="block text-xs font-normal text-slate-500">
                    {place}
                  </span>
                </span>
              </Tooltip>
            </Marker>
          );
        })}
      </MapContainer>

      {selected ? (
        <div className="absolute inset-x-4 bottom-4 z-[1000] mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-lg sm:inset-x-auto sm:left-4 sm:right-auto sm:w-[360px]">
          <p className="text-base font-semibold text-slate-900">{selected.name}</p>
          <p className="mt-1 text-sm text-slate-600">
            {[selected.addressLine, selected.city].filter(Boolean).join(", ") ||
              selected.region ||
              "Адрес уточняется"}
          </p>
          <div className="mt-3 flex gap-2">
            <Link
              className="inline-flex flex-1 items-center justify-center rounded-full bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
              href={`/business/${selected.slug}`}
            >
              Карточка
            </Link>
            <button
              className="rounded-full border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600"
              onClick={() => setSelectedId(null)}
              type="button"
            >
              Закрыть
            </button>
          </div>
        </div>
      ) : null}

      {mappable.length === 0 ? (
        <div className="pointer-events-none absolute inset-x-4 bottom-4 z-[1000] rounded-lg bg-white/95 px-3 py-2 text-center text-sm text-slate-600 shadow-sm">
          Пока нет бизнесов с адресами на карте
        </div>
      ) : null}
    </div>
  );
}
