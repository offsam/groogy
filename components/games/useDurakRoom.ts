"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

const ROOM_KEY = "durak-room-key";

export type DurakRoomCounts = {
  watching: number;
  waiting: number;
};

type PresenceMeta = {
  userId: string | null;
  seated: boolean;
  queued: boolean;
};

function roomKey(userId: string | null): string {
  if (userId) return userId;
  const existing = window.sessionStorage.getItem(ROOM_KEY);
  if (existing) return existing;
  const next = crypto.randomUUID();
  window.sessionStorage.setItem(ROOM_KEY, next);
  return next;
}

function countsFrom(
  raw: Record<string, PresenceMeta[]>,
  seatedIds: Set<string>,
): DurakRoomCounts {
  const watching = new Set<string>();
  const waiting = new Set<string>();
  for (const [key, entries] of Object.entries(raw)) {
    const meta = entries[0];
    if (!meta) continue;
    const id = meta.userId ?? key;
    if (meta.seated || (meta.userId != null && seatedIds.has(meta.userId))) continue;
    watching.add(id);
    if (meta.queued) waiting.add(id);
  }
  return { watching: watching.size, waiting: waiting.size };
}

/** Live watchers and the seat queue for one table. No database table: Supabase Presence drops the moment the page closes. */
export function useDurakRoom(
  tableId: number,
  viewer: { userId: string | null; seated: boolean; queued: boolean },
  seatedIds: string[],
): DurakRoomCounts {
  const [counts, setCounts] = useState<DurakRoomCounts>({ watching: 0, waiting: 0 });
  const seatedKey = seatedIds.join(",");

  useEffect(() => {
    let closed = false;
    const client = createBrowserClient();
    const channel = client.channel(`durak-room-${tableId}`, {
      config: { presence: { key: roomKey(viewer.userId) } },
    });
    const seated = new Set(seatedKey ? seatedKey.split(",") : []);
    const recount = () => {
      if (closed) return;
      const state = channel.presenceState<PresenceMeta>();
      setCounts(countsFrom(state, seated));
    };
    channel.on("presence", { event: "sync" }, recount);
    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      void channel.track({
        userId: viewer.userId,
        seated: viewer.seated,
        queued: viewer.queued && !viewer.seated,
      });
    });
    return () => {
      closed = true;
      void client.removeChannel(channel);
    };
  }, [tableId, viewer.userId, viewer.seated, viewer.queued, seatedKey]);

  return counts;
}
