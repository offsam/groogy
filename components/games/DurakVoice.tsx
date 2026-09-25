"use client";

import { Room, RoomEvent, Track } from "livekit-client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { durakVoiceTokenAction } from "@/lib/games/durak/actions";

const GUEST_KEY = "durak-voice-guest";

function guestId(): string {
  const existing = window.sessionStorage.getItem(GUEST_KEY);
  if (
    existing &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      existing,
    )
  ) {
    return existing;
  }
  const next = crypto.randomUUID();
  window.sessionStorage.setItem(GUEST_KEY, next);
  return next;
}

export function DurakVoice({ tableId }: { tableId: number }) {
  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  const [talking, setTalking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      void roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, []);

  function attach(room: Room) {
    const host = audioRef.current;
    if (!host) return;
    const play = (track: Track) => {
      if (track.kind !== Track.Kind.Audio) return;
      const element = track.attach();
      element.autoplay = true;
      host.appendChild(element);
    };
    room.on(RoomEvent.TrackSubscribed, (track) => play(track));
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      for (const element of track.detach()) element.remove();
    });
  }

  async function enable() {
    setBusy(true);
    setMessage(null);
    try {
      const ticket = await durakVoiceTokenAction(tableId, guestId());
      if (!ticket.ok) {
        setMessage(ticket.message);
        return;
      }
      const room = new Room();
      attach(room);
      await room.connect(ticket.url, ticket.token);
      await room.localParticipant.setMicrophoneEnabled(false);
      roomRef.current = room;
      setOn(true);
    } catch {
      setMessage("Не удалось подключить голос.");
      await roomRef.current?.disconnect();
      roomRef.current = null;
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setTalking(false);
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setOn(false);
  }

  async function talk(next: boolean) {
    const room = roomRef.current;
    if (!room) return;
    setTalking(next);
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
    } catch {
      setTalking(false);
      setMessage("Нет доступа к микрофону.");
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <div ref={audioRef} className="hidden" />
      <div className="flex flex-wrap gap-2">
        {on ? (
          <>
            <button
              className={`inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-medium text-white ${
                talking ? "bg-brand-red" : "bg-brand-blue hover:bg-brand-blue-deep"
              }`}
              type="button"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                void talk(true);
              }}
              onPointerUp={() => void talk(false)}
              onPointerCancel={() => void talk(false)}
            >
              {talking ? "Говорите" : "Сказать"}
            </button>
            <Button className="min-h-11" disabled={busy} variant="secondary" onClick={() => void disable()}>
              Выключить голос
            </Button>
          </>
        ) : (
          <Button className="min-h-11" disabled={busy} loading={busy} onClick={() => void enable()}>
            Включить голос
          </Button>
        )}
      </div>
      <p className="text-xs text-slate-500">
        {message ??
          "Держите «Сказать», чтобы вас слышали все, кто открыл этот стол. Голос можно выключить."}
      </p>
    </div>
  );
}
