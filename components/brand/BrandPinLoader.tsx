"use client";

import { cn } from "@/lib/utils";

/** Pin with plate removed — true transparent background. */
const MARK_SRC = "/brand/krugi-mark-loader.png";

export type BrandPinLoaderSize = "sm" | "md" | "lg" | "page";

const SIZE_PX: Record<BrandPinLoaderSize, number> = {
  sm: 16,
  md: 22,
  lg: 32,
  page: 64,
};

type Props = {
  className?: string;
  size?: BrandPinLoaderSize;
  pixels?: number;
  label?: string;
};

/**
 * Brand pin loader: colour wave from center, then grey wave — no spin, no plate.
 */
export function BrandPinLoader({
  className,
  size = "sm",
  pixels,
  label = "Загрузка",
}: Props) {
  const px = pixels ?? SIZE_PX[size];
  return (
    <span
      aria-label={label}
      className={cn(
        "brand-pin-loader relative inline-block shrink-0 align-middle bg-transparent",
        className,
      )}
      role="status"
      style={{ width: px, height: px }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        aria-hidden
        className="brand-pin-loader__base pointer-events-none absolute inset-0 size-full object-contain select-none"
        draggable={false}
        src={MARK_SRC}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        aria-hidden
        className="brand-pin-loader__color pointer-events-none absolute inset-0 size-full object-contain select-none"
        draggable={false}
        src={MARK_SRC}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        aria-hidden
        className="brand-pin-loader__gray pointer-events-none absolute inset-0 size-full object-contain select-none"
        draggable={false}
        src={MARK_SRC}
      />
    </span>
  );
}
