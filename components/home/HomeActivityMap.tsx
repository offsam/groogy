"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { RegionHub } from "@/lib/regions/hubs";
import { isLatLngInHubBounds, mergeHubsForMap } from "@/lib/regions/hubs";
import { MapAttribution } from "@/components/map/MapAttribution";
import { hasCoordinates, type Business } from "@/types/business";
import { cn } from "@/lib/utils";

/** Vertical map plane only (no side twist). Softer tilt than a hard wall. */
const MAP_TILT_X = 64;
/** Far (top) edge width ÷ near (bottom) edge width — trapezoid map face. */
const MAP_TOP_WIDTH_RATIO = 2;
/**
 * Extra map height toward the stats strip.
 * Fade ends at half of this (MAP_TOP_FADE).
 */
const MAP_TOP_GROW = "2.5rem";
const MAP_TOP_FADE = "1.25rem";

type ActivityKind = "new" | "popular";

type LabelPlacement = "top" | "right" | "left" | "bottom";

type ActivityPin = {
  id: string;
  kind: ActivityKind;
  title: string;
  subtitle: string | null;
  href: string | null;
  /** Geographic tip on the map face (%) */
  left: number;
  top: number;
  /** Where the name card sits relative to the tip */
  label: LabelPlacement;
  /** Extra horizontal shift of the card only (px) */
  labelNudgeX: number;
};

type MapViewport = {
  width: number;
  height: number;
};

type HomeActivityMapProps = {
  hub: RegionHub;
  hubs?: RegionHub[];
  newest?: Business[];
  popular?: Business[];
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

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/** Web-Mercator → % on the real Leaflet face (must match container px). */
function projectToMap(
  lat: number,
  lng: number,
  hub: RegionHub,
  viewport: MapViewport,
): { left: number; top: number } {
  const zoom = hub.mapZoom;
  const scale = 256 * 2 ** zoom;

  const toWorld = (φ: number, λ: number) => {
    const x = ((λ + 180) / 360) * scale;
    const sin = Math.sin((φ * Math.PI) / 180);
    const y =
      (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
    return { x, y };
  };

  const center = toWorld(hub.mapCenter.lat, hub.mapCenter.lng);
  const point = toWorld(lat, lng);

  const mapWidthPx = Math.max(1, viewport.width);
  const mapHeightPx = Math.max(1, viewport.height);

  const left = 50 + ((point.x - center.x) / mapWidthPx) * 100;
  const top = 50 + ((point.y - center.y) / mapHeightPx) * 100;

  // Soft clamp only if barely off-face — never invent a new city
  return {
    left: clamp(left, 2, 98),
    top: clamp(top, 2, 98),
  };
}

function inSelectedHub(b: Business, hub: RegionHub): boolean {
  if (!hasCoordinates(b)) return false;
  if (!isLatLngInHubBounds(b.latitude, b.longitude, hub)) return false;

  const city = (b.city ?? "").trim().toLowerCase();
  const region = (b.region ?? "").trim().toLowerCase();
  const place = `${city} ${region}`;

  // Soft place-name guards — neighboring metros must not leak when coords are fuzzy
  if (hub.id === "orange-county") {
    if (
      /\blos angeles\b|studio city|glendale|burbank|santa monica|beverly hills|west hollywood|westlake|sherman oaks|van nuys|pasadena|long beach|southern california|\bsan diego\b|chula vista|la jolla/.test(
        place,
      )
    ) {
      return false;
    }
  }
  if (hub.id === "los-angeles") {
    if (
      /orange county|\birvine\b|anaheim|tustin|huntington beach|laguna|fountain valley|costa mesa|mission viejo|fullerton|santa ana|\bsan diego\b|chula vista|la jolla/.test(
        place,
      )
    ) {
      return false;
    }
  }
  if (hub.id === "san-diego") {
    if (
      /\blos angeles\b|orange county|\birvine\b|anaheim|glendale|burbank|santa monica|long beach|pasadena/.test(
        place,
      )
    ) {
      return false;
    }
  }

  return true;
}

function inSelectedHubs(b: Business, hubs: readonly RegionHub[]): boolean {
  if (!hasCoordinates(b)) return false;
  return hubs.some((hub) => inSelectedHub(b, hub));
}

function pinsTooClose(
  a: { left: number; top: number },
  b: { left: number; top: number },
) {
  // Only block near-identical spots (OC cities sit close on this zoom)
  return Math.hypot(a.left - b.left, a.top - b.top) < 6;
}

const TARGET_PIN_COUNT = 4;
const MAP_DISTRICTS = ["nw", "ne", "sw", "se"] as const;
type MapDistrict = (typeof MAP_DISTRICTS)[number];

/** Assign a business to one of four map districts (spread pins across the hub). */
function districtFor(b: Business, hub: RegionHub): MapDistrict | null {
  if (!hasCoordinates(b)) return null;

  const city = (b.city ?? "").trim().toLowerCase();

  // OC: city-first so coastal west (Newport / Costa Mesa) stays its own corner
  if (hub.id === "orange-county") {
    if (
      /newport|costa mesa|huntington|fountain valley|seal beach/.test(city)
    ) {
      return "sw";
    }
    if (
      /santa ana|tustin|anaheim|fullerton|orange\b|placentia|yorba|buena park|garden grove|westminster/.test(
        city,
      )
    ) {
      return "nw";
    }
    if (/laguna niguel|laguna beach|dana point|san clemente/.test(city)) {
      return "se";
    }
    if (
      /mission viejo|lake forest|rancho|irvine|aliso|laguna hills|laguna woods|san juan/.test(
        city,
      )
    ) {
      return "ne";
    }
  }

  const midLat = (hub.mapBounds.north + hub.mapBounds.south) / 2;
  const midLng = (hub.mapBounds.west + hub.mapBounds.east) / 2;
  const north = b.latitude >= midLat;
  const west = b.longitude < midLng;
  if (north && west) return "nw";
  if (north && !west) return "ne";
  if (!north && west) return "sw";
  return "se";
}

function pinKindFor(
  b: Business,
  newestIds: Set<string>,
): ActivityKind {
  if (newestIds.has(b.id)) return "new";
  const score = b.googleRating ?? b.ratingAvg ?? 0;
  return score >= 4 || (b.googleReviewsCount ?? 0) > 0 ? "popular" : "new";
}

function scoreCandidate(b: Business, newestIds: Set<string>): number {
  const rating = b.googleRating ?? b.ratingAvg ?? 0;
  const reviews = Math.min(b.googleReviewsCount ?? 0, 80);
  const fresh = newestIds.has(b.id) ? 8 : 0;
  return rating * 12 + reviews * 0.15 + fresh;
}

function buildPins(
  hubs: readonly RegionHub[],
  newest: Business[],
  popular: Business[],
  viewport: MapViewport | null,
): ActivityPin[] {
  if (!viewport || viewport.width < 8 || viewport.height < 8) return [];
  const hub = mergeHubsForMap(hubs);

  const used = new Set<string>();
  const pins: ActivityPin[] = [];
  const newestIds = new Set(newest.map((b) => b.id));

  const pool = [...newest, ...popular].filter(
    (b, i, arr) =>
      arr.findIndex((x) => x.id === b.id) === i &&
      hasCoordinates(b) &&
      inSelectedHubs(b, hubs) &&
      b.locationPrecision !== "county",
  );

  const tryPush = (b: Business, opts?: { ignoreSpacing?: boolean }) => {
    if (used.has(b.id) || !hasCoordinates(b)) return false;
    const pos = projectToMap(b.latitude, b.longitude, hub, viewport);
    // Skip only if truly off the visible face
    if (pos.left < 1 || pos.left > 99 || pos.top < 1 || pos.top > 99) {
      return false;
    }
    if (
      !opts?.ignoreSpacing &&
      pins.some((p) => pinsTooClose(p, pos))
    ) {
      return false;
    }

    const kind = pinKindFor(b, newestIds);
    used.add(b.id);
    pins.push({
      id: `${kind}-${b.id}`,
      kind,
      title: b.name,
      subtitle: b.city,
      href: `/business/${b.slug}`,
      ...pos,
      label: "top",
      labelNudgeX: 0,
    });
    return true;
  };

  // One pin per district — true lat/lng only (no visual nudging)
  const byDistrict = new Map<MapDistrict, Business[]>();
  for (const id of MAP_DISTRICTS) byDistrict.set(id, []);
  for (const b of pool) {
    const d = districtFor(b, hub);
    if (!d) continue;
    byDistrict.get(d)!.push(b);
  }

  for (const id of MAP_DISTRICTS) {
    const candidates = [...(byDistrict.get(id) ?? [])].sort(
      (a, b) => scoreCandidate(b, newestIds) - scoreCandidate(a, newestIds),
    );
    for (const b of candidates) {
      if (tryPush(b, { ignoreSpacing: true })) break;
    }
  }

  if (pins.length < TARGET_PIN_COUNT) {
    const leftovers = [...pool].sort(
      (a, b) => scoreCandidate(b, newestIds) - scoreCandidate(a, newestIds),
    );
    for (const b of leftovers) {
      if (pins.length >= TARGET_PIN_COUNT) break;
      tryPush(b);
    }
  }

  return layoutPinLabels(pins.slice(0, TARGET_PIN_COUNT), viewport);
}

/** Card size in map-face % — keep tip fixed, move only the name block. */
function labelBox(
  pin: Pick<ActivityPin, "left" | "top">,
  label: LabelPlacement,
  nudgePct: number,
  viewport: MapViewport,
): { x: number; y: number; w: number; h: number } {
  // Slightly oversized vs CSS so collision is stricter than the eye
  const w = Math.max(4.5, (130 / viewport.width) * 100);
  const h = Math.max(5.5, (70 / viewport.height) * 100);
  const gap = Math.max(0.4, (10 / viewport.width) * 100);
  const logo = Math.max(1.2, (22 / viewport.height) * 100);
  const lx = pin.left + nudgePct;

  switch (label) {
    case "right":
      return { x: pin.left + gap + nudgePct, y: pin.top - h * 0.85, w, h };
    case "left":
      return { x: pin.left - w - gap + nudgePct, y: pin.top - h * 0.85, w, h };
    case "bottom":
      return { x: lx - w / 2, y: pin.top + logo * 0.5, w, h };
    case "top":
    default:
      return { x: lx - w / 2, y: pin.top - h - logo * 0.4, w, h };
  }
}

function boxesOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  pad = 2.5,
) {
  return !(
    a.x + a.w + pad <= b.x ||
    b.x + b.w + pad <= a.x ||
    a.y + a.h + pad <= b.y ||
    b.y + b.h + pad <= a.y
  );
}

function boxInFace(box: { x: number; y: number; w: number; h: number }) {
  return (
    box.x >= 0.5 &&
    box.x + box.w <= 99.5 &&
    box.y >= 0.5 &&
    box.y + box.h <= 99.5
  );
}

/**
 * Prefer left/right (+ nudges). Tip stays on coords; only the name plate moves.
 */
function layoutPinLabels(
  pins: ActivityPin[],
  viewport: MapViewport,
): ActivityPin[] {
  const nudgesPct = [0, -4, 4, -8, 8, -12, 12, -18, 18, -24, 24];
  const placed: ActivityPin[] = [];
  const boxes: { x: number; y: number; w: number; h: number }[] = [];

  const order = [...pins].sort((a, b) => a.top - b.top || a.left - b.left);

  for (const pin of order) {
    let chosen: ActivityPin | null = null;
    const preferRight = placed.length % 2 === 0;
    const orderedPlacements: LabelPlacement[] = preferRight
      ? ["right", "left", "top", "bottom"]
      : ["left", "right", "top", "bottom"];

    outer: for (const label of orderedPlacements) {
      for (const nudgePct of nudgesPct) {
        const box = labelBox(pin, label, nudgePct, viewport);
        if (!boxInFace(box)) continue;
        if (boxes.some((other) => boxesOverlap(box, other))) continue;
        chosen = {
          ...pin,
          label,
          labelNudgeX: (nudgePct / 100) * viewport.width,
        };
        boxes.push(box);
        break outer;
      }
    }

    if (!chosen) {
      const fallbackSide: LabelPlacement = pin.left < 50 ? "right" : "left";
      for (const nudgePct of [0, 8, -8, 16, -16, 28, -28, 40, -40]) {
        const box = labelBox(pin, fallbackSide, nudgePct, viewport);
        if (!boxInFace(box)) continue;
        if (boxes.some((other) => boxesOverlap(box, other))) continue;
        chosen = {
          ...pin,
          label: fallbackSide,
          labelNudgeX: (nudgePct / 100) * viewport.width,
        };
        boxes.push(box);
        break;
      }
    }

    if (!chosen) {
      const nudgePct = pin.left < 50 ? 40 : -40;
      chosen = {
        ...pin,
        label: pin.left < 50 ? "right" : "left",
        labelNudgeX: (nudgePct / 100) * viewport.width,
      };
      boxes.push(labelBox(chosen, chosen.label, nudgePct, viewport));
    }
    placed.push(chosen);
  }

  const byId = new Map(placed.map((p) => [p.id, p]));
  return pins.map((p) => byId.get(p.id) ?? p);
}

function PinMarker({ pin }: { pin: ActivityPin }) {
  const isNew = pin.kind === "new";

  // Opaque plate, hard edge, no blur/shadow — soft shadows shimmer on 3D
  const card = (
    <div className="hidden w-[100px] rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-left sm:block sm:w-[110px]">
      <span
        className={cn(
          "mb-0.5 block text-[8px] font-semibold uppercase tracking-wide",
          isNew ? "text-brand-green-deep" : "text-brand-orange",
        )}
      >
        {isNew ? "Новое" : "Популярное"}
      </span>
      <span className="line-clamp-2 text-[10px] font-semibold leading-snug text-slate-900">
        {pin.title}
      </span>
      {pin.subtitle ? (
        <span className="mt-0.5 block truncate text-[9px] text-slate-700">
          {pin.subtitle}
        </span>
      ) : null}
    </div>
  );

  const cardNode = pin.href ? (
    <Link className="block" href={pin.href}>
      {card}
    </Link>
  ) : (
    <div>{card}</div>
  );

  const logo = (
    <img
      alt=""
      className="h-4 w-4 shrink-0 object-contain sm:h-[18px] sm:w-[18px]"
      draggable={false}
      height={18}
      src="/brand/krugi-mark-transparent-256.png"
      width={18}
    />
  );

  const cardShift =
    pin.labelNudgeX !== 0 ? (
      <div style={{ transform: `translateX(${pin.labelNudgeX}px)` }}>{cardNode}</div>
    ) : (
      cardNode
    );

  // Face the screen; avoid translateZ (z-fights with tiles → flicker)
  const faceUp = (origin: string) =>
    ({
      transform: `rotateX(${-MAP_TILT_X}deg)`,
      transformOrigin: origin,
      transformStyle: "preserve-3d",
      backfaceVisibility: "hidden",
      WebkitBackfaceVisibility: "hidden",
      WebkitFontSmoothing: "antialiased",
    }) as const;

  let body: ReactNode;
  if (pin.label === "right") {
    body = (
      <div
        className="pointer-events-auto absolute bottom-0 left-0 flex items-end gap-1"
        style={faceUp("bottom left")}
      >
        {logo}
        {cardShift}
      </div>
    );
  } else if (pin.label === "left") {
    body = (
      <div
        className="pointer-events-auto absolute bottom-0 right-0 flex items-end gap-1"
        style={faceUp("bottom right")}
      >
        {cardShift}
        {logo}
      </div>
    );
  } else if (pin.label === "bottom") {
    body = (
      <div
        className="pointer-events-auto absolute left-0 top-0 flex -translate-x-1/2 flex-col items-center gap-0.5"
        style={faceUp("top center")}
      >
        {logo}
        {cardShift}
      </div>
    );
  } else {
    body = (
      <div
        className="pointer-events-auto absolute bottom-0 left-0 flex -translate-x-1/2 flex-col items-center gap-0.5"
        style={faceUp("bottom center")}
      >
        {cardShift}
        {logo}
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: `${pin.left}%`,
        top: `${pin.top}%`,
        transformStyle: "preserve-3d",
        backfaceVisibility: "hidden",
      }}
    >
      {body}
    </div>
  );
}

export function HomeActivityMap({
  hub,
  hubs,
  newest = [],
  popular = [],
}: HomeActivityMapProps) {
  const faceRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<MapViewport | null>(null);
  const selectedHubs = hubs && hubs.length > 0 ? hubs : [hub];
  const hubsKey = selectedHubs.map((h) => h.id).join(",");
  const multiRegion = selectedHubs.length >= 2;
  const wideRegion = selectedHubs.length >= 3;
  const mapHub = useMemo(
    () => mergeHubsForMap(selectedHubs),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hubsKey captures selection
    [hubsKey],
  );

  useLayoutEffect(() => {
    const el = faceRef.current;
    if (!el) return;

    const measure = () => {
      // Round hard — tiny ResizeObserver jitter remounts labels and looks like flicker
      const width = Math.round(el.clientWidth / 8) * 8;
      const height = Math.round(el.clientHeight / 8) * 8;
      if (width < 8 || height < 8) return;
      setViewport((prev) => {
        if (
          prev &&
          Math.abs(prev.width - width) < 8 &&
          Math.abs(prev.height - height) < 8
        ) {
          return prev;
        }
        return { width, height };
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // After 3D layout / font settle
    const t1 = window.setTimeout(measure, 80);
    const t2 = window.setTimeout(measure, 240);
    return () => {
      observer.disconnect();
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [hubsKey]);

  const pins = useMemo(
    () => buildPins(selectedHubs, newest, popular, viewport),
    [selectedHubs, newest, popular, viewport],
  );

  // Near edge centered under the wide far edge
  const nearLeft = 50 - 50 / MAP_TOP_WIDTH_RATIO;
  const nearRight = 50 + 50 / MAP_TOP_WIDTH_RATIO;

  return (
    <section className="relative w-full overflow-x-hidden pb-0 pt-0">
      {/* Flush under the stats strip — map grows up into that junction */}
      <div
        className="relative mx-auto w-full max-w-[1600px] px-0"
        style={{ perspective: "1300px", perspectiveOrigin: "50% 0%" }}
      >
        <div
          className="relative w-full"
          style={{
            transform: `rotateX(${MAP_TILT_X}deg)`,
            transformOrigin: "center top",
            transformStyle: "preserve-3d",
          }}
        >
          {/*
            Height = aspect ratio + MAP_TOP_GROW (real map pixels, not empty gap).
            padding-bottom sizing keeps Leaflet geometry stable.
          */}
          <div
            className={cn(
              "relative w-full",
              wideRegion
                ? "pb-[calc(62%+2.5rem)] sm:pb-[calc(52%+2.5rem)]"
                : multiRegion
                  ? "pb-[calc(56%+2.5rem)] sm:pb-[calc(46%+2.5rem)]"
                  : "pb-[calc(50%+2.5rem)] sm:pb-[calc(40.909%+2.5rem)]",
            )}
            style={{ transformStyle: "preserve-3d" }}
          >
            <div
              className="absolute inset-0"
              style={{ transformStyle: "preserve-3d" }}
            >
              {/* Map face only — clip-path flattens 3D, so pins stay outside */}
              <div
                ref={faceRef}
                className="absolute left-1/2 top-0 h-full"
                style={{
                  width: `${MAP_TOP_WIDTH_RATIO * 100}%`,
                  transform: "translateX(-50%)",
                  clipPath: `polygon(0% 0%, 100% 0%, ${nearRight}% 100%, ${nearLeft}% 100%)`,
                }}
              >
                <div className="pointer-events-none absolute inset-0 overflow-hidden">
                  <HomeActivityMapCanvas key={hubsKey} hub={mapHub} />
                </div>

                {/* Fade starts at top, clears by half of the top grow */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 z-[5]"
                  style={{
                    background: `
                      linear-gradient(to bottom, var(--background) 0%, transparent ${MAP_TOP_FADE}),
                      linear-gradient(to right, var(--background) 0%, transparent 1.5%, transparent 98.5%, var(--background) 100%),
                      linear-gradient(to bottom, transparent 90%, var(--background) 100%)
                    `,
                  }}
                />
              </div>

              {/* Pins share the same wider face coords, but keep upright */}
              <div
                className="pointer-events-none absolute left-1/2 top-0 z-[6] h-full"
                style={{
                  width: `${MAP_TOP_WIDTH_RATIO * 100}%`,
                  transform: "translateX(-50%)",
                  transformStyle: "preserve-3d",
                }}
              >
                {pins.map((pin) => (
                  <PinMarker key={pin.id} pin={pin} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Flat overlay — map CTA (desktop). Mobile uses a separate row below. */}
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
