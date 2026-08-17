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
  clustersFromHubCounts,
  clustersFromMetroGroupCounts,
  clustersFromStateCounts,
  groupPinsByHub,
  groupPinsByMetroGroup,
  groupPinsByState,
  homeMapLayerForZoom,
  leftoverStateCounts,
  leftoverClusters,
  type HomeMapPlaceCluster,
} from "@/lib/geo/home-map-clusters";
import { OSM_ATTRIBUTION, OSM_TILE_URL } from "@/lib/map/tiles";
import type { RegionHub } from "@/lib/regions/hubs";
import type {
  HomeMapHubCount,
  HomeMapPin,
  HomeMapStateCount,
} from "@/lib/supabase/queries";

const CARD_WIDTH = 352;
const CARD_HEIGHT_EST = 168;
const CARD_GAP = 14;
const STATE_CALLOUT_STROKE = "#12468F";

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
  const digits = String(count).length;
  const size = Math.min(56, Math.max(40, 30 + digits * 7));
  const fontSize = digits >= 4 ? 12 : digits >= 3 ? 13 : 15;
  return L.divIcon({
    className: "home-map-count-icon",
    html: `<div class="home-map-state-count krugi-glass-bubble" style="width:${size}px;height:${size}px"><span class="krugi-glass-bubble__shine"></span><span class="krugi-glass-bubble__spec"></span><span class="home-map-state-count__n" style="font-size:${fontSize}px">${count}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    tooltipAnchor: [0, -size / 2 + 2],
  });
}

function countLabelRu(count: number): string {
  if (count === 1) return "карточка";
  if (count < 5) return "карточки";
  return "карточек";
}

/** Count circles for state / metro / hub layers. */
function PlaceCountLabels({
  clusters,
  callouts,
  onSelect,
}: {
  clusters: HomeMapPlaceCluster[];
  callouts?: Record<string, { lat: number; lng: number }>;
  onSelect: (pin: HomeMapPin | null) => void;
}) {
  const map = useMap();

  const pick = useMemo(
    () => (cluster: HomeMapPlaceCluster) => {
      onSelect(null);
      map.flyTo([cluster.lat, cluster.lng], cluster.flyZoom, {
        animate: true,
        duration: 0.55,
      });
    },
    [map, onSelect],
  );

  return (
    <>
      {clusters.map((cluster) => {
        const callout = callouts?.[cluster.id];
        const labelPos = callout ?? { lat: cluster.lat, lng: cluster.lng };
        return (
          <Fragment key={cluster.id}>
            {callout ? (
              <Polyline
                interactive={false}
                pathOptions={{ color: STATE_CALLOUT_STROKE, weight: 1 }}
                positions={[
                  [cluster.lat, cluster.lng],
                  [callout.lat, callout.lng],
                ]}
              />
            ) : null}
            {callout ? (
              <CircleMarker
                center={[cluster.lat, cluster.lng]}
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
                  {cluster.label}
                  <span className="mt-0.5 block text-xs font-normal text-slate-500">
                    {cluster.count} {countLabelRu(cluster.count)}
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

function ResizeHandler() {
  const map = useMap();
  useEffect(() => {
    let timer = 0;
    const settle = () => map.invalidateSize({ animate: false, pan: false });
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, 80);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(map.getContainer());
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    const t = window.setTimeout(settle, 80);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
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
  /** Kept for callers; overview bubbles prefer `stateCountsFallback`. */
  pinsLoaded: boolean;
  /** Catalog card counts per state (not only rows with coordinates). */
  stateCountsFallback: HomeMapStateCount[] | null;
  hubCountsFallback: HomeMapHubCount[] | null;
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
  hubCountsFallback,
  selectedPin,
  cardPoint,
  onSelect,
  onCardPoint,
}: HomeActivityMapCanvasProps) {
  const idleIcon = useMemo(() => createHomePinIcon(false), []);
  const activeIcon = useMemo(() => createHomePinIcon(true), []);
  const selectedId = selectedPin?.id ?? null;
  const [zoom, setZoom] = useState(hub.mapZoom);
  const layer = homeMapLayerForZoom(zoom);
  const showPins = layer === "pins";

  useEffect(() => {
    if (!showPins && selectedPin) onSelect(null);
  }, [showPins, selectedPin, onSelect]);

  const placeClusters = useMemo(() => {
    if (layer === "pins") return [];
    const leftovers =
      stateCountsFallback && hubCountsFallback
        ? leftoverStateCounts(stateCountsFallback, hubCountsFallback)
        : [];
    if (layer === "state") {
      if (stateCountsFallback && stateCountsFallback.length > 0) {
        return clustersFromStateCounts(stateCountsFallback);
      }
      return groupPinsByState(pins);
    }
    if (layer === "metro-group") {
      if (hubCountsFallback && hubCountsFallback.length > 0) {
        return clustersFromMetroGroupCounts(hubCountsFallback, leftovers);
      }
      return groupPinsByMetroGroup(pins);
    }
    if (hubCountsFallback && hubCountsFallback.length > 0) {
      return [
        ...clustersFromHubCounts(hubCountsFallback),
        ...leftoverClusters(leftovers),
      ];
    }
    return groupPinsByHub(pins);
  }, [hubCountsFallback, layer, pins, stateCountsFallback]);

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
        {selectedPin && showPins ? (
          <PinCardAnchor onPoint={onCardPoint} pin={selectedPin} />
        ) : null}

        {showPins ? (
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
        ) : (
          <PlaceCountLabels
            callouts={layer === "state" ? STATE_CALLOUTS : undefined}
            clusters={placeClusters}
            onSelect={onSelect}
          />
        )}
      </MapContainer>

      {selectedPin && cardPoint && showPins ? (
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
