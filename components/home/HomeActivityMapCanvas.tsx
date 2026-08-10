"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
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
import type { HomeMapPin, HomeMapStateCount } from "@/lib/supabase/queries";

const CARD_WIDTH = 352;
const CARD_HEIGHT_EST = 168;
const CARD_GAP = 14;
const STATE_CALLOUT_STROKE = "#12468F";

type StateCluster = {
  code: string;
  count: number;
  centroid: UsStateCentroid;
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

/**
 * Tiny, crowded Northeast states get their count pulled out over the
 * Atlantic with a leader line back to the real state, instead of stacking
 * illegibly on top of each other at national zoom.
 */
const STATE_CALLOUTS: Record<string, { lat: number; lng: number }> = {
  "US-RI": { lat: 42.6, lng: -68.2 },
  "US-CT": { lat: 41.7, lng: -68.2 },
  "US-NJ": { lat: 40.8, lng: -68.2 },
  "US-DE": { lat: 39.9, lng: -68.2 },
  "US-DC": { lat: 39.0, lng: -68.2 },
};

function createStateDigitIcon(count: number): L.DivIcon {
  const width = Math.max(26, 15 + String(count).length * 9);
  return L.divIcon({
    className: "",
    html: `<div class="home-map-state-count" style="width:${width}px">${count}</div>`,
    iconSize: [width, 22],
    iconAnchor: [width / 2, 11],
  });
}

/** Per-state card counts only — no fill, no pins until the user zooms in. */
function StateCountLabels({
  clusters,
  onSelect,
}: {
  clusters: StateCluster[];
  onSelect: (pin: HomeMapPin | null) => void;
}) {
  const map = useMap();

  const pick = useMemo(
    () => (cluster: StateCluster) => {
      onSelect(null);
      map.flyTo(
        [cluster.centroid.lat, cluster.centroid.lng],
        Math.max(cluster.centroid.zoom, HOME_MAP_STATE_CLUSTER_MAX_ZOOM + 0.25),
        { animate: true, duration: 0.55 },
      );
    },
    [map, onSelect],
  );

  return (
    <>
      {clusters.map((cluster) => {
        const callout = STATE_CALLOUTS[cluster.code];
        const labelPos = callout ?? {
          lat: cluster.centroid.lat,
          lng: cluster.centroid.lng,
        };
        return (
          <Fragment key={cluster.code}>
            {callout ? (
              <Polyline
                interactive={false}
                pathOptions={{ color: STATE_CALLOUT_STROKE, weight: 1 }}
                positions={[
                  [cluster.centroid.lat, cluster.centroid.lng],
                  [callout.lat, callout.lng],
                ]}
              />
            ) : null}
            {callout ? (
              <CircleMarker
                center={[cluster.centroid.lat, cluster.centroid.lng]}
                interactive={false}
                pathOptions={{
                  color: STATE_CALLOUT_STROKE,
                  fillColor: STATE_CALLOUT_STROKE,
                  fillOpacity: 1,
                }}
                radius={3}
              />
            ) : null}
            <Marker
              eventHandlers={{
                click: (event) => {
                  L.DomEvent.stopPropagation(event.originalEvent);
                  pick(cluster);
                },
              }}
              icon={createStateDigitIcon(cluster.count)}
              position={[labelPos.lat, labelPos.lng]}
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
          </Fragment>
        );
      })}
    </>
  );
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
    });
  }
  return clusters;
}

/**
 * Same cluster shape as `groupPinsByState`, built from the lightweight
 * counts-only payload — used before the full nationwide pins have loaded.
 */
function clustersFromStateCounts(counts: HomeMapStateCount[]): StateCluster[] {
  const clusters: StateCluster[] = [];
  for (const { stateCode, count } of counts) {
    const centroid = getUsStateCentroid(stateCode);
    if (!centroid) continue;
    clusters.push({ code: stateCode, count, centroid });
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

type HomeActivityMapCanvasProps = {
  hub: RegionHub;
  pins: HomeMapPin[];
  /** False while the (heavier) nationwide pin fetch is still in flight. */
  pinsLoaded: boolean;
  /** Lightweight per-state counts shown until `pinsLoaded` is true. */
  stateCountsFallback: HomeMapStateCount[] | null;
  selectedPin: HomeMapPin | null;
  cardPoint: { left: number; top: number } | null;
  onSelect: (pin: HomeMapPin | null) => void;
  onCardPoint: (point: { left: number; top: number } | null) => void;
};

/** Interactive basemap; pin click opens a BusinessCard-style preview near the pin. */
export default function HomeActivityMapCanvas({
  hub,
  pins,
  pinsLoaded,
  stateCountsFallback,
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

  const stateClusters = useMemo(() => {
    if (!showStateClusters) return [];
    if (pinsLoaded || !stateCountsFallback) return groupPinsByState(pins);
    return clustersFromStateCounts(stateCountsFallback);
  }, [pins, pinsLoaded, showStateClusters, stateCountsFallback]);

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

        {showStateClusters ? (
          <StateCountLabels clusters={stateClusters} onSelect={onSelect} />
        ) : (
          pins.map((pin) => (
            <PinMarker
              active={selectedId === pin.id}
              activeIcon={activeIcon}
              idleIcon={idleIcon}
              key={`${pin.kind}-${pin.id}`}
              onSelect={onSelect}
              pin={pin}
            />
          ))
        )}
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
