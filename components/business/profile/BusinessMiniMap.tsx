"use client";

import dynamic from "next/dynamic";

const BusinessMiniMapCanvas = dynamic(
  () => import("@/components/business/profile/BusinessMiniMapCanvas"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[8.5rem] items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-400">
        Карта…
      </div>
    ),
  },
);

type BusinessMiniMapProps = {
  lat: number;
  lng: number;
  zoom?: number;
  /** City / county precision → area map without a misleading exact pin. */
  showMarker?: boolean;
};

export function BusinessMiniMap(props: BusinessMiniMapProps) {
  return <BusinessMiniMapCanvas {...props} />;
}
