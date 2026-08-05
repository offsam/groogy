"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { HomeMapPinCard } from "@/components/home/HomeMapPinCard";
import {
  HOME_MAP_STATE_CLUSTER_MAX_ZOOM,
  getUsStateCentroid,
  normalizeUsStateCode,
  type UsStateCentroid,
} from "@/lib/geo/us-state-centroids";
import { OSM_ATTRIBUTION, OSM_TILE_URL } from "@/lib/map/tiles";
import type { RegionHub } from "@/lib/regions/hubs";
import type { HomeMapPin } from "@/lib/supabase/queries";

const CARD_WIDTH = 352;
const CARD_HEIGHT_EST = 168;
const CARD_GAP = 14;

type StateCluster = {
  code: string;
  count: number;
  centroid: UsStateCentroid;
  /** When count === 1, keep the real pin instead of a circle. */
  solePin: HomeMapPin | null;
};

function createHomePinIcon(active: boolean) {
  const size = active ? 28 : 22;
  return L.divIcon({
    className: "",
    html: `<img alt="" class="home-map-pin${active ? " home-map-pin--active" : ""}" height="${size}" src="/brand/krugi-mark-transparent-256.png" width="${size}" />`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size - 2],
    tooltipAnchor: [0, -(size - 4)],
  });
}

function createStateClusterIcon(count: number) {
  const size = Math.min(58, Math.max(34, Math.round(28 + Math.sqrt(count) * 3.2)));
  const fontSize = count >= 1000 ? 11 : count >= 100 ? 12 : 13;
  return L.divIcon({
    className: "",
    html: `<div class="home-map-state-cluster" style="width:${size}px;height:${size}px;font-size:${fontSize}px">${count}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    tooltipAnchor: [0, -size / 2 + 2],
  });
}

function groupPinsByState(pins: HomeMapPin[]): StateCluster[] {
  const buckets = new Map<string, HomeMapPin[]>();
  for (const pin of pins) {
    const code = normalizeUsStateCode(pin.stateCode);
    if (!code) continue;
    const list = buckets.get(code);
    if (list) list.push(pin);
    else buckets.set(code, [pin]);
  }

  const clusters: StateCluster[] = [];
  for (const [code, list] of buckets) {
    const centroid = getUsStateCentroid(code);
    if (!centroid) continue;
    clusters.push({
      code,
      count: list.length,
      centroid,
      solePin: list.length === 1 ? list[0] : null,
    });
  }
  return clusters;
}

function ResizeHandler() {
  const map = useMap();
  useEffect(() => {
    let timer = 0;
    const settle = () => map.invalidateSize({ animate: false, pan: false });
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, 120);
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

/** Sync hub view only when lat/lng/zoom values actually change — never on pin select. */
function SyncView({
  lat,
  lng,
  zoom,
}: {
  lat: number;
  lng: number;
  zoom: number;
}) {
  const map = useMap();
  const last = useRef<{ lat: number; lng: number; zoom: number } | null>(null);
  useEffect(() => {
    const prev = last.current;
    if (
      prev &&
      Math.abs(prev.lat - lat) < 1e-7 &&
      Math.abs(prev.lng - lng) < 1e-7 &&
      Math.abs(prev.zoom - zoom) < 1e-4
    ) {
      return;
    }
    last.current = { lat, lng, zoom };
    map.setView([lat, lng], zoom, { animate: false });
  }, [lat, lng, zoom, map]);
  return null;
}

function MapClickClear({ onClear }: { onClear: () => void }) {
  useMapEvents({
    click: () => onClear(),
  });
  return null;
}

function ZoomWatcher({
  onZoom,
}: {
  onZoom: (zoom: number) => void;
}) {
  const map = useMap();
  useEffect(() => {
    onZoom(map.getZoom());
    const handle = () => onZoom(map.getZoom());
    map.on("zoom zoomend", handle);
    return () => {
      map.off("zoom zoomend", handle);
    };
  }, [map, onZoom]);
  return null;
}

/** Keep floating card anchored to the selected pin as the map pans/zooms. */
function PinCardAnchor({
  pin,
  onPoint,
}: {
  pin: HomeMapPin;
  onPoint: (point: { left: number; top: number } | null) => void;
}) {
  const map = useMap();

  useEffect(() => {
    const update = () => {
      const pt = map.latLngToContainerPoint([pin.latitude, pin.longitude]);
      const size = map.getSize();
      const width = Math.min(CARD_WIDTH, size.x - 16);
      let left = pt.x - width / 2;
      let top = pt.y - CARD_HEIGHT_EST - CARD_GAP;
      // Prefer above the pin; if clipped, show below.
      if (top < 8) top = pt.y + CARD_GAP + 10;
      left = Math.max(8, Math.min(left, size.x - width - 8));
      top = Math.max(8, Math.min(top, size.y - CARD_HEIGHT_EST - 8));
      onPoint({ left, top });
    };
    update();
    map.on("move zoom moveend zoomend resize", update);
    return () => {
      map.off("move zoom moveend zoomend resize", update);
      onPoint(null);
    };
  }, [map, pin.latitude, pin.longitude, pin.id, onPoint]);

  return null;
}

function PinMarker({
  pin,
  active,
  idleIcon,
  activeIcon,
  onSelect,
}: {
  pin: HomeMapPin;
  active: boolean;
  idleIcon: L.DivIcon;
  activeIcon: L.DivIcon;
  onSelect: (pin: HomeMapPin | null) => void;
}) {
  return (
    <Marker
      eventHandlers={{
        click: (event) => {
          L.DomEvent.stopPropagation(event.originalEvent);
          onSelect(pin);
        },
      }}
      icon={active ? activeIcon : idleIcon}
      position={[pin.latitude, pin.longitude]}
      zIndexOffset={active ? 1000 : 0}
    >
      <Tooltip direction="top" opacity={1}>
        <span className="text-sm font-semibold text-slate-900">
          {pin.name}
          {pin.city ? (
            <span className="mt-0.5 block text-xs font-normal text-slate-500">
              {pin.city}
            </span>
          ) : null}
        </span>
      </Tooltip>
    </Marker>
  );
}

function StateClusterMarker({
  cluster,
  icon,
  onSelect,
}: {
  cluster: StateCluster;
  icon: L.DivIcon;
  onSelect: (pin: HomeMapPin | null) => void;
}) {
  const map = useMap();
  return (
    <Marker
      eventHandlers={{
        click: (event) => {
          L.DomEvent.stopPropagation(event.originalEvent);
          onSelect(null);
          map.flyTo(
            [cluster.centroid.lat, cluster.centroid.lng],
            Math.max(
              cluster.centroid.zoom,
              HOME_MAP_STATE_CLUSTER_MAX_ZOOM + 0.25,
            ),
            { animate: true, duration: 0.55 },
          );
        },
      }}
      icon={icon}
      position={[cluster.centroid.lat, cluster.centroid.lng]}
      zIndexOffset={200}
    >
      <Tooltip direction="top" opacity={1}>
        <span className="text-sm font-semibold text-slate-900">
          {cluster.centroid.labelRu}
          <span className="mt-0.5 block text-xs font-normal text-slate-500">
            {cluster.count}{" "}
            {cluster.count === 1
              ? "точка на карте"
              : cluster.count < 5
                ? "точки на карте"
                : "точек на карте"}
          </span>
        </span>
      </Tooltip>
    </Marker>
  );
}

type HomeActivityMapCanvasProps = {
  hub: RegionHub;
  pins: HomeMapPin[];
  selectedPin: HomeMapPin | null;
  cardPoint: { left: number; top: number } | null;
  onSelect: (pin: HomeMapPin | null) => void;
  onCardPoint: (point: { left: number; top: number } | null) => void;
};

/** Interactive basemap; pin click opens a BusinessCard-style preview near the pin. */
export default function HomeActivityMapCanvas({
  hub,
  pins,
  selectedPin,
  cardPoint,
  onSelect,
  onCardPoint,
}: HomeActivityMapCanvasProps) {
  const idleIcon = useMemo(() => createHomePinIcon(false), []);
  const activeIcon = useMemo(() => createHomePinIcon(true), []);
  const selectedId = selectedPin?.id ?? null;
  const [zoom, setZoom] = useState(hub.mapZoom);
  const showStateClusters = zoom < HOME_MAP_STATE_CLUSTER_MAX_ZOOM;

  useEffect(() => {
    if (showStateClusters && selectedPin) onSelect(null);
  }, [showStateClusters, selectedPin, onSelect]);

  const stateClusters = useMemo(
    () => (showStateClusters ? groupPinsByState(pins) : []),
    [pins, showStateClusters],
  );

  const clusterIcons = useMemo(() => {
    const map = new Map<string, L.DivIcon>();
    for (const cluster of stateClusters) {
      if (cluster.solePin) continue;
      map.set(cluster.code, createStateClusterIcon(cluster.count));
    }
    return map;
  }, [stateClusters]);

  /** Pins without a known state stay visible even when clustered. */
  const orphanPins = useMemo(() => {
    if (!showStateClusters) return pins;
    return pins.filter((pin) => {
      const code = normalizeUsStateCode(pin.stateCode);
      return !code || !getUsStateCentroid(code);
    });
  }, [pins, showStateClusters]);

  return (
    <div className="relative z-[450] h-full w-full">
      <MapContainer
        attributionControl={false}
        center={[hub.mapCenter.lat, hub.mapCenter.lng]}
        className="home-activity-leaflet h-full w-full"
        doubleClickZoom
        dragging
        keyboard
        scrollWheelZoom
        touchZoom
        zoom={hub.mapZoom}
        zoomControl={false}
        zoomSnap={0.25}
      >
        <TileLayer attribution={OSM_ATTRIBUTION} url={OSM_TILE_URL} />
        <ZoomControl position="bottomright" />
        <ResizeHandler />
        <ZoomWatcher onZoom={setZoom} />
        <SyncView
          lat={hub.mapCenter.lat}
          lng={hub.mapCenter.lng}
          zoom={hub.mapZoom}
        />
        <MapClickClear onClear={() => onSelect(null)} />
        {selectedPin && !showStateClusters ? (
          <PinCardAnchor onPoint={onCardPoint} pin={selectedPin} />
        ) : null}

        {showStateClusters
          ? stateClusters.map((cluster) => {
              if (cluster.solePin) {
                return (
                  <PinMarker
                    active={selectedId === cluster.solePin.id}
                    activeIcon={activeIcon}
                    idleIcon={idleIcon}
                    key={`sole-${cluster.code}`}
                    onSelect={onSelect}
                    pin={cluster.solePin}
                  />
                );
              }
              const icon = clusterIcons.get(cluster.code);
              if (!icon) return null;
              return (
                <StateClusterMarker
                  cluster={cluster}
                  icon={icon}
                  key={`state-${cluster.code}`}
                  onSelect={onSelect}
                />
              );
            })
          : pins.map((pin) => (
              <PinMarker
                active={selectedId === pin.id}
                activeIcon={activeIcon}
                idleIcon={idleIcon}
                key={`${pin.kind}-${pin.id}`}
                onSelect={onSelect}
                pin={pin}
              />
            ))}

        {showStateClusters
          ? orphanPins.map((pin) => (
              <PinMarker
                active={selectedId === pin.id}
                activeIcon={activeIcon}
                idleIcon={idleIcon}
                key={`orphan-${pin.kind}-${pin.id}`}
                onSelect={onSelect}
                pin={pin}
              />
            ))
          : null}
      </MapContainer>

      {selectedPin && cardPoint && !showStateClusters ? (
        <div
          className="pointer-events-auto absolute z-[660]"
          style={{ left: cardPoint.left, top: cardPoint.top }}
        >
          <HomeMapPinCard onClose={() => onSelect(null)} pin={selectedPin} />
        </div>
      ) : null}
    </div>
  );
}
