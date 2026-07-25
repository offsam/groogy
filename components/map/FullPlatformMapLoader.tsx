"use client";

import dynamic from "next/dynamic";
import type { Business } from "@/types/business";

const FullPlatformMap = dynamic(() => import("@/components/map/FullPlatformMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[calc(100dvh-5.5rem)] w-full items-center justify-center bg-slate-100 text-sm text-slate-500">
      Загрузка карты…
    </div>
  ),
});

export function FullPlatformMapLoader({
  businesses,
}: {
  businesses: Business[];
}) {
  return <FullPlatformMap businesses={businesses} />;
}
