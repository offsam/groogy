"use client";

import { useEffect } from "react";
import { persistGuestHubIds, parseHubIds } from "@/lib/regions/hubs";

/** Keep cookie/localStorage aligned when landing with ?hub= from home pins. */
export function SyncHubCookie({ hubId }: { hubId: string }) {
  useEffect(() => {
    const ids = parseHubIds(hubId);
    // Don't overwrite a national USA selection with an empty/default parse glitch.
    if (ids.length === 0) return;
    persistGuestHubIds(ids);
  }, [hubId]);
  return null;
}
