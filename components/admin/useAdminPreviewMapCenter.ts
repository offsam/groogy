"use client";

import { useEffect, useState } from "react";
import {
  queryCityCenter,
  type CityCenter,
} from "@/lib/geo/city-center-query";
import { createBrowserClient } from "@/lib/supabase/client";

/**
 * Same city-center fallback live profile pages pass as `cityMapCenter`.
 * Admin queue preview is client-only — resolve on the browser via anon key.
 */
export function useAdminPreviewMapCenter(
  city: string | null | undefined,
  stateCode: string | null | undefined,
  opts?: { postalCode?: string | null; region?: string | null },
): CityCenter | null {
  const [center, setCenter] = useState<CityCenter | null>(null);
  const postalCode = opts?.postalCode ?? null;
  const region = opts?.region ?? null;

  useEffect(() => {
    let cancelled = false;
    const cityTrim = city?.trim() || "";
    if (!cityTrim) {
      setCenter(null);
      return;
    }
    const client = createBrowserClient();
    void queryCityCenter(client, cityTrim, stateCode, {
      postalCode,
      region,
    }).then((result) => {
      if (!cancelled) setCenter(result);
    });
    return () => {
      cancelled = true;
    };
  }, [city, stateCode, postalCode, region]);

  return center;
}
