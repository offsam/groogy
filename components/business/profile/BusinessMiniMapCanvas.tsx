"use client";

import { useEffect } from "react";
import L from "leaflet";
import {
  AttributionControl,
  MapContainer,
  Marker,
  TileLayer,
  useMap,
} from "react-leaflet";
import { MAP_ATTRIBUTION_CONTROL, OSM_ATTRIBUTION, OSM_TILE_URL } from "@/lib/map/tiles";
import { MapAttribution } from "@/components/map/MapAttribution";

const pinIcon = L.divIcon({
  className: "",
  html: `<div class="marker-pin"></div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 28],
});

function ResizeHandler() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

type BusinessMiniMapCanvasProps = {
  lat: number;
  lng: number;
  zoom?: number;
};

export default function BusinessMiniMapCanvas({
  lat,
  lng,
  zoom = 14,
}: BusinessMiniMapCanvasProps) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-slate-100">
      <MapContainer
        attributionControl={false}
        center={[lat, lng]}
        className="h-40 w-full [&_.leaflet-control-attribution]:hidden"
        doubleClickZoom={false}
        dragging={false}
        scrollWheelZoom={false}
        zoom={zoom}
        zoomControl={false}
      >
        <AttributionControl {...MAP_ATTRIBUTION_CONTROL} />
        <TileLayer attribution={OSM_ATTRIBUTION} url={OSM_TILE_URL} />
        <Marker icon={pinIcon} position={[lat, lng]} />
        <ResizeHandler />
      </MapContainer>
      <MapAttribution className="absolute bottom-1 right-1 rounded bg-white/85 px-1.5 py-0.5 text-[9px] leading-none text-slate-500" />
    </div>
  );
}
