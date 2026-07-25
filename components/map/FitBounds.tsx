"use client";

import { useEffect } from "react";
import { useMap } from "react-leaflet";
import type { LatLngExpression } from "leaflet";

/** Fit the map once to the given points (street pins with addresses). */
export function FitBounds({ points }: { points: LatLngExpression[] }) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      const only = points[0]!;
      const latLng = Array.isArray(only)
        ? (only as [number, number])
        : ([only.lat, only.lng] as [number, number]);
      map.setView(latLng, Math.max(map.getZoom(), 12), { animate: false });
      return;
    }
    map.fitBounds(points as [number, number][], {
      padding: [48, 48],
      maxZoom: 12,
      animate: false,
    });
  }, [map, points]);

  return null;
}
