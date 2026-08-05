"use client";

import { useId, type ReactNode } from "react";
import { KRUGI_PIN_PATHS, type PinPathNode } from "@/components/brand/krugi-pin-paths";
import { cn } from "@/lib/utils";

/** Brand pin marks — hub set under the map + legacy sheet pins. */
export const KRUGI_PIN_NAMES = [
  "businesses",
  "professionals",
  "services",
  "reviews",
  "listings",
  "jobs",
  "real_estate",
  "auto",
  "food",
  "lechu",
  "transfers",
  "messages",
  "community",
  "churches",
  "favorites",
  "events",
  "promos",
  "news",
  "profile",
  "verification",
  "reputation",
  "help",
  "settings",
  "logout",
] as const;

export type KrugiPinName = (typeof KRUGI_PIN_NAMES)[number];

/** Fully filled logo-color disk (no K) — shared camouflage field. */
const LOGO_DISK_SRC = "/brand/krugi-logo-disk.png";

const GLYPH_TRANSFORM = "translate(21 21) scale(2.41667)";

/** Per-pin disk orientation so colors land differently on each glyph. */
function diskRotationDeg(name: KrugiPinName): number {
  const i = KRUGI_PIN_NAMES.indexOf(name);
  return Math.round(((i < 0 ? 0 : i) * 137.508) % 360);
}

type KrugiPinIconProps = {
  name: KrugiPinName;
  className?: string;
  alt?: string;
};

function renderMaskNodes(nodes: PinPathNode[]): ReactNode {
  return (
    <g
      fill="none"
      stroke="white"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2.45}
      transform={GLYPH_TRANSFORM}
    >
      {nodes.map((node, i) => {
        const { tag, ...attrs } = node;
        if (tag === "path") {
          return <path d={String(attrs.d ?? "")} key={i} />;
        }
        if (tag === "circle") {
          return (
            <circle cx={attrs.cx} cy={attrs.cy} key={i} r={attrs.r} />
          );
        }
        if (tag === "rect") {
          return (
            <rect
              height={attrs.height}
              key={i}
              rx={attrs.rx}
              ry={attrs.ry}
              width={attrs.width}
              x={attrs.x}
              y={attrs.y}
            />
          );
        }
        if (tag === "line") {
          return (
            <line
              key={i}
              x1={attrs.x1}
              x2={attrs.x2}
              y1={attrs.y1}
              y2={attrs.y2}
            />
          );
        }
        if (tag === "polyline" || tag === "polygon") {
          const Poly = tag;
          return <Poly key={i} points={String(attrs.points ?? "")} />;
        }
        return null;
      })}
    </g>
  );
}

/**
 * Glass bubble. Logo-disk colors show through a fixed upright glyph mask.
 * Disk rotation changes color placement only — never the icon shape.
 */
export function KrugiPinIcon({ name, className, alt = "" }: KrugiPinIconProps) {
  const uid = useId().replace(/:/g, "");
  const maskId = `krugi-mask-${uid}`;
  const nodes = KRUGI_PIN_PATHS[name];
  const rot = diskRotationDeg(name);

  return (
    <span
      aria-hidden={alt ? undefined : true}
      aria-label={alt || undefined}
      className={cn(
        "krugi-glass-bubble relative inline-flex shrink-0 items-center justify-center",
        className,
      )}
      role={alt ? "img" : undefined}
    >
      <span aria-hidden className="krugi-glass-bubble__shine" />
      <span aria-hidden className="krugi-glass-bubble__spec" />

      <svg
        aria-hidden
        className="relative z-[1] size-full"
        viewBox="0 0 100 100"
      >
        <defs>
          <mask
            id={maskId}
            maskContentUnits="userSpaceOnUse"
            maskUnits="userSpaceOnUse"
          >
            <rect fill="black" height="100" width="100" />
            {renderMaskNodes(nodes)}
          </mask>
        </defs>

        {/* Mask on the group: glyph stays upright; only the disk spins */}
        <g mask={`url(#${maskId})`}>
          <image
            height="100"
            href={LOGO_DISK_SRC}
            preserveAspectRatio="xMidYMid slice"
            transform={`rotate(${rot} 50 50)`}
            width="100"
          />
        </g>
      </svg>
    </span>
  );
}
