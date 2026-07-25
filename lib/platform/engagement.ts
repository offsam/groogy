"use client";

import { createBrowserClient } from "@/lib/supabase/client";
import {
  isPopularResourceKind,
  pathForPopularResource,
  type PopularResourceKind,
} from "@/lib/platform/resource-kinds";

/**
 * Fire-and-forget open tracking for popularity ranking.
 * Writes platform_events.event_type = 'click' with entity meta.
 */
export function trackResourceOpen(input: {
  kind: PopularResourceKind | string;
  id: string;
  /** Business cards use slug in the URL; listings use id. */
  pathId?: string;
  path?: string;
}): void {
  const kind = input.kind;
  const id = input.id?.trim();
  if (!id || !isPopularResourceKind(kind)) return;

  const path =
    input.path?.slice(0, 500) ||
    pathForPopularResource(kind, input.pathId?.trim() || id);

  void (async () => {
    try {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      await supabase.from("platform_events").insert({
        event_type: "click",
        path,
        referrer:
          typeof document !== "undefined"
            ? document.referrer.slice(0, 500) || null
            : null,
        user_id: user?.id ?? null,
        meta: {
          entity_type: kind,
          entity_id: id,
          surface: "open",
        },
      });
    } catch {
      // Analytics must never break navigation.
    }
  })();
}
