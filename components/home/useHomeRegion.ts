"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  GUEST_REGION_STORAGE_KEY,
  USA_OVERVIEW_HUB,
  formatHubsInLabel,
  getRegionHubById,
  getRegionHubsByIds,
  isUsaOverviewHub,
  parseHubIds,
  persistGuestHubIds,
  serializeHubIds,
  type RegionHub,
} from "@/lib/regions/hubs";

export type HomeRegionState = {
  hubs: RegionHub[];
  /** Primary hub (first selected) — panorama / fallback. */
  hub: RegionHub;
  inLabel: string;
  source: "profile" | "geo" | "storage" | "default" | "manual";
  countyGeoid: string | null;
};

type GeoApiResponse = {
  hubId: string | null;
  inLabel: string;
  panoramaUrl: string;
  shortLabel?: string | null;
  mapCenter: { lat: number; lng: number };
  mapZoom: number;
  exampleQueries: string[];
  countyGeoid: string;
  knownHub: boolean;
  error?: string;
};

function readStoredHubIds(): string[] | null {
  try {
    const raw = localStorage.getItem(GUEST_REGION_STORAGE_KEY);
    if (!raw) return null;
    const ids = parseHubIds(raw);
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

function stateFromHubs(
  hubs: RegionHub[],
  source: HomeRegionState["source"],
): HomeRegionState {
  const list = hubs.length > 0 ? hubs : [USA_OVERVIEW_HUB];
  return {
    hubs: list,
    hub: list[0],
    inLabel: formatHubsInLabel(list),
    source,
    countyGeoid: list[0].countyGeoids[0] ?? null,
  };
}

export function useHomeRegion(options: {
  lockedFromProfile: boolean;
  initialHub: RegionHub;
  initialInLabel: string;
  initialCountyGeoid: string | null;
}) {
  const router = useRouter();
  const [region, setRegion] = useState<HomeRegionState>(() =>
    stateFromHubs(
      [options.initialHub],
      options.lockedFromProfile
        ? "profile"
        : isUsaOverviewHub(options.initialHub)
          ? "default"
          : "storage",
    ),
  );
  const [geoStatus, setGeoStatus] = useState<
    "idle" | "prompt" | "loading" | "denied" | "done"
  >(options.lockedFromProfile ? "done" : "idle");

  useEffect(() => {
    if (options.lockedFromProfile) {
      persistGuestHubIds([options.initialHub.id]);
      setRegion(stateFromHubs([options.initialHub], "profile"));
      return;
    }

    const stored = readStoredHubIds();
    if (stored) {
      const hubs = getRegionHubsByIds(stored);
      persistGuestHubIds(hubs.map((h) => h.id));
      setRegion(stateFromHubs(hubs, "storage"));
      setGeoStatus("done");
      return;
    }

    // No saved region / no profile → USA overview until guest picks or allows geo.
    setRegion(stateFromHubs([USA_OVERVIEW_HUB], "default"));
    setGeoStatus("prompt");
  }, [options.lockedFromProfile, options.initialHub]);

  const applyGeoResult = useCallback(
    (data: GeoApiResponse) => {
      const hub = data.hubId
        ? getRegionHubById(data.hubId)
        : {
            ...USA_OVERVIEW_HUB,
            inLabel: data.inLabel,
            panoramaUrl: data.panoramaUrl,
            mapCenter: data.mapCenter,
            mapZoom: data.mapZoom,
            exampleQueries: data.exampleQueries,
          };
      if (data.hubId) persistGuestHubIds([hub.id]);
      setRegion({
        ...stateFromHubs([hub], "geo"),
        inLabel: data.inLabel || hub.inLabel,
        countyGeoid: data.countyGeoid,
      });
      setGeoStatus("done");
      router.refresh();
    },
    [router],
  );

  const requestGeolocation = useCallback(() => {
    if (options.lockedFromProfile) return;
    if (!navigator.geolocation) {
      setGeoStatus("denied");
      return;
    }
    setGeoStatus("loading");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch("/api/geo/resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            }),
          });
          if (!res.ok) {
            setGeoStatus("denied");
            return;
          }
          const data = (await res.json()) as GeoApiResponse;
          applyGeoResult(data);
        } catch {
          setGeoStatus("denied");
        }
      },
      () => setGeoStatus("denied"),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 600_000 },
    );
  }, [applyGeoResult, options.lockedFromProfile]);

  const dismissGeoPrompt = useCallback(() => {
    setGeoStatus("done");
  }, []);

  const setHubs = useCallback(
    (nextIds: string[]) => {
      const hubs = getRegionHubsByIds(nextIds);
      const metros = hubs.filter((h) => !isUsaOverviewHub(h));
      const list =
        metros.length > 0
          ? metros
          : [USA_OVERVIEW_HUB];
      persistGuestHubIds(list.map((h) => h.id));
      setRegion(stateFromHubs(list, "manual"));
      setGeoStatus("done");
      router.refresh();
    },
    [router],
  );

  /** Toggle one hub in the multi-select (always keep at least one). */
  const toggleHub = useCallback(
    (hubId: string) => {
      const id = getRegionHubById(hubId).id;
      if (id === "usa-overview") {
        setHubs(["usa-overview"]);
        return;
      }
      const current = region.hubs
        .map((h) => h.id)
        .filter((x) => x !== "usa-overview");
      const exists = current.includes(id);
      let next: string[];
      if (exists) {
        next = current.filter((x) => x !== id);
        if (next.length === 0) next = ["usa-overview"];
      } else {
        next = [...current, id];
      }
      setHubs(next);
    },
    [region.hubs, setHubs],
  );

  /** Replace selection with a single hub (legacy). */
  const selectHub = useCallback(
    (hubId: string) => {
      setHubs([hubId]);
    },
    [setHubs],
  );

  const hubIdsParam = useMemo(() => {
    if (isUsaOverviewHub(region.hub) || region.source === "default") {
      return "";
    }
    return serializeHubIds(region.hubs.map((h) => h.id));
  }, [region.hub, region.hubs, region.source]);

  const nationalOverview =
    region.source === "default" || isUsaOverviewHub(region.hub);

  return {
    region,
    hubIdsParam,
    nationalOverview,
    geoStatus,
    requestGeolocation,
    dismissGeoPrompt,
    selectHub,
    toggleHub,
    setHubs,
  };
}
