import { cookies } from "next/headers";
import {
  GUEST_REGION_COOKIE,
  USA_OVERVIEW_HUB,
  type RegionHub,
} from "@/lib/regions/hubs";
import {
  hubsForPlaceTokens,
  parsePlaceTokens,
} from "@/lib/geo/place-tokens";

/** Resolve active hubs from URL `hub` param, else guest cookie, else USA. */
export async function resolveRequestHubs(
  hubParam?: string | null,
): Promise<RegionHub[]> {
  if (hubParam) {
    return hubsForPlaceTokens(parsePlaceTokens(hubParam));
  }
  try {
    const store = await cookies();
    const raw = store.get(GUEST_REGION_COOKIE)?.value;
    if (raw) {
      return hubsForPlaceTokens(
        parsePlaceTokens(decodeURIComponent(raw)),
      );
    }
  } catch {
    // ignore
  }
  return [USA_OVERVIEW_HUB];
}

/** @deprecated prefer resolveRequestHubs — returns primary (first) hub. */
export async function resolveRequestHub(
  hubParam?: string | null,
): Promise<RegionHub> {
  const hubs = await resolveRequestHubs(hubParam);
  return hubs[0] ?? USA_OVERVIEW_HUB;
}
