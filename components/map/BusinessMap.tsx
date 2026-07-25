"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import {
  AttributionControl,
  CircleMarker,
  MapContainer,
  Marker,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import { hasCoordinates, type Business } from "@/types/business";
import { MAP_ATTRIBUTION_CONTROL, OSM_ATTRIBUTION, OSM_TILE_URL } from "@/lib/map/tiles";

const OC_CENTER: [number, number] = [33.69, -117.83];

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
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  return null;
}

function FlyToSelected({
  business,
}: {
  business: (Business & { latitude: number; longitude: number }) | undefined;
}) {
  const map = useMap();

  useEffect(() => {
    if (!business) return;
    // County-level: stay zoomed out to the county area; street: zoom in.
    const targetZoom =
      business.locationPrecision === "county"
        ? Math.min(map.getZoom(), 10)
        : Math.max(map.getZoom(), 12);
    const zoom =
      business.locationPrecision === "county" ? 10 : targetZoom;
    map.flyTo([business.latitude, business.longitude], zoom, {
      duration: 0.6,
    });
  }, [business, map]);

  return null;
}

type BusinessMapProps = {
  businesses: Business[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  center?: [number, number];
  zoom?: number;
};

export default function BusinessMap({
  businesses,
  selectedId,
  onSelect,
  center = OC_CENTER,
  zoom = 10,
}: BusinessMapProps) {
  const mappable = useMemo(() => businesses.filter(hasCoordinates), [businesses]);

  const selectedBusiness = useMemo(
    () => mappable.find((b) => b.id === selectedId),
    [mappable, selectedId],
  );

  const withoutCoords = businesses.length - mappable.length;

  return (
    <div className="relative h-full w-full">
      <MapContainer
        attributionControl={false}
        center={center}
        className="h-full w-full rounded-xl"
        scrollWheelZoom
        zoom={zoom}
      >
        <AttributionControl {...MAP_ATTRIBUTION_CONTROL} />
        <TileLayer attribution={OSM_ATTRIBUTION} url={OSM_TILE_URL} />
        <ResizeHandler />
        <FlyToSelected business={selectedBusiness} />
        {mappable.map((business) => {
          const selected = business.id === selectedId;
          const isCounty = business.locationPrecision === "county";

          if (isCounty) {
            return (
              <CircleMarker
                key={business.id}
                center={[business.latitude, business.longitude]}
                eventHandlers={{ click: () => onSelect(business.id) }}
                pathOptions={{
                  color: selected ? "#dc2626" : "#475569",
                  fillColor: selected ? "#f87171" : "#94a3b8",
                  fillOpacity: 0.28,
                  weight: selected ? 2.5 : 1.5,
                }}
                radius={selected ? 28 : 22}
              >
                <Tooltip direction="top">
                  <span className="text-sm font-medium">
                    {business.name}
                    <span className="block text-xs font-normal text-slate-500">
                      {business.city ?? "County"} · район
                    </span>
                  </span>
                </Tooltip>
              </CircleMarker>
            );
          }

          return (
            <Marker
              key={business.id}
              eventHandlers={{ click: () => onSelect(business.id) }}
              icon={createPinIcon(selected)}
              position={[business.latitude, business.longitude]}
              zIndexOffset={selected ? 1000 : 0}
            >
              <Tooltip direction="top">
                <span className="text-sm font-medium">{business.name}</span>
              </Tooltip>
            </Marker>
          );
        })}
      </MapContainer>

      {mappable.length === 0 && (
        <div className="pointer-events-none absolute inset-x-4 bottom-4 z-[500] rounded-lg bg-white/95 px-3 py-2 text-center text-sm text-slate-600 shadow-sm">
          Нет компаний с координатами для отображения на карте
        </div>
      )}

      {withoutCoords > 0 && mappable.length > 0 && (
        <div className="pointer-events-none absolute inset-x-4 bottom-4 z-[500] rounded-lg bg-white/95 px-3 py-2 text-center text-xs text-slate-500 shadow-sm">
          {withoutCoords}{" "}
          {withoutCoords === 1 ? "компания без координат" : "компаний без координат"} — только в
          списке
        </div>
      )}
    </div>
  );
}
