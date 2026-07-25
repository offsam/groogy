import { cookies } from "next/headers";
import {
  DEFAULT_REGION_HUB,
  GUEST_REGION_COOKIE,
  getRegionHubsByIds,
  parseHubIds,
  type RegionHub,
} from "@/lib/regions/hubs";

/** Resolve active hub list from URL `hub` param, else guest cookie, else default. */
export async function resolveRequestHubs(
  hubParam?: string | null,
): Promise<RegionHub[]> {
  if (hubParam) return getRegionHubsByIds(parseHubIds(hubParam));
  try {
    const store = await cookies();
    const raw = store.get(GUEST_REGION_COOKIE)?.value;
    if (raw) return getRegionHubsByIds(parseHubIds(decodeURIComponent(raw)));
  } catch {
    // ignore
  }
  return [DEFAULT_REGION_HUB];
}

/** @deprecated prefer resolveRequestHubs — returns primary (first) hub. */
export async function resolveRequestHub(
  hubParam?: string | null,
): Promise<RegionHub> {
  const hubs = await resolveRequestHubs(hubParam);
  return hubs[0] ?? DEFAULT_REGION_HUB;
}
