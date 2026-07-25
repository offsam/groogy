"use client";

import { useEffect } from "react";
import { persistGuestHubIds, parseHubIds } from "@/lib/regions/hubs";

/** Keep cookie/localStorage aligned when landing with ?hub= from home pins. */
export function SyncHubCookie({ hubId }: { hubId: string }) {
  useEffect(() => {
    persistGuestHubIds(parseHubIds(hubId));
  }, [hubId]);
  return null;
}
