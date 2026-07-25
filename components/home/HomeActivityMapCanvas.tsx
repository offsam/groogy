"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import { OSM_ATTRIBUTION, OSM_TILE_URL } from "@/lib/map/tiles";
import type { RegionHub } from "@/lib/regions/hubs";

function ResizeHandler() {
  const map = useMap();
  useEffect(() => {
    let lastW = 0;
    let lastH = 0;
    let timer = 0;

    const settle = () => {
      const size = map.getSize();
      if (
        Math.abs(size.x - lastW) < 4 &&
        Math.abs(size.y - lastH) < 4 &&
        lastW > 0
      ) {
        return;
      }
      lastW = size.x;
      lastH = size.y;
      map.invalidateSize({ animate: false, pan: false });
    };

    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, 200);
    });
    observer.observe(map.getContainer());
    const t = window.setTimeout(settle, 160);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      window.clearTimeout(t);
    };
  }, [map]);
  return null;
}

function SyncView({
  center,
  zoom,
}: {
  center: [number, number];
  zoom: number;
}) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom, { animate: false });
  }, [center, map, zoom]);
  return null;
}

type HomeActivityMapCanvasProps = {
  hub: RegionHub;
};

/** Frozen basemap only — no markers, no controls, no interaction. */
export default function HomeActivityMapCanvas({
  hub,
}: HomeActivityMapCanvasProps) {
  const center: [number, number] = [hub.mapCenter.lat, hub.mapCenter.lng];
  const zoom = hub.mapZoom;

  return (
    <MapContainer
      attributionControl={false}
      boxZoom={false}
      center={center}
      className="home-activity-leaflet h-full w-full"
      doubleClickZoom={false}
      dragging={false}
      keyboard={false}
      key={`${hub.mapCenter.lat.toFixed(3)}-${hub.mapCenter.lng.toFixed(3)}-${zoom}`}
      scrollWheelZoom={false}
      touchZoom={false}
      zoom={zoom}
      zoomControl={false}
      zoomSnap={0}
    >
      <TileLayer attribution={OSM_ATTRIBUTION} url={OSM_TILE_URL} />
      <ResizeHandler />
      <SyncView center={center} zoom={zoom} />
    </MapContainer>
  );
}
