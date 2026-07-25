"use client";

import dynamic from "next/dynamic";

const BusinessMiniMapCanvas = dynamic(
  () => import("@/components/business/profile/BusinessMiniMapCanvas"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-40 items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-400">
        Карта…
      </div>
    ),
  },
);

type BusinessMiniMapProps = {
  lat: number;
  lng: number;
  zoom?: number;
};

export function BusinessMiniMap(props: BusinessMiniMapProps) {
  return <BusinessMiniMapCanvas {...props} />;
}
