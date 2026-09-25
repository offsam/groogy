"use client";

import { Room, RoomEvent, Track } from "livekit-client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { durakVoiceTokenAction } from "@/lib/games/durak/actions";

const GUEST_KEY = "durak-voice-guest";

export type SeatVoice = "on" | "speaking";

export type DurakVoiceState = {
  micOn: boolean;
  hearing: boolean;
  selfSpeaking: boolean;
  busy: boolean;
  message: string | null;
  voices: Record<string, SeatVoice>;
  toggleMic: () => void;
  toggleHearing: () => void;
  audio: ReactNode;
};

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

function remoteVoices(room: Room): Record<string, SeatVoice> {
  const speakers = new Set(room.activeSpeakers.map((person) => person.identity));
  const voices: Record<string, SeatVoice> = {};
  for (const person of room.remoteParticipants.values()) {
    const mic = person.getTrackPublication(Track.Source.Microphone);
    if (!mic || mic.isMuted) continue;
    voices[person.identity] = speakers.has(person.identity) ? "speaking" : "on";
  }
  return voices;
}

export function useDurakVoice(tableId: number): DurakVoiceState {
  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const hearingRef = useRef(false);
  const [micOn, setMicOn] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [selfSpeaking, setSelfSpeaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [voices, setVoices] = useState<Record<string, SeatVoice>>({});

  function applyHearing(next: boolean) {
    hearingRef.current = next;
    setHearing(next);
    audioRef.current?.querySelectorAll("audio").forEach((element) => {
      element.muted = !next;
    });
  }

  function refresh(room: Room) {
    setVoices(remoteVoices(room));
    const mine = room.localParticipant;
    const published = mine.getTrackPublication(Track.Source.Microphone);
    const live =
      Boolean(published && !published.isMuted) &&
      room.activeSpeakers.some((person) => person.identity === mine.identity);
    setSelfSpeaking(live);
  }

  function bind(room: Room) {
    const host = audioRef.current;
    const play = (track: Track) => {
      if (track.kind !== Track.Kind.Audio || !host) return;
      const element = track.attach();
      element.autoplay = true;
      element.muted = !hearingRef.current;
      host.appendChild(element);
    };
    room.on(RoomEvent.TrackSubscribed, (track) => play(track));
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      for (const element of track.detach()) element.remove();
    });
    const update = () => refresh(room);
    room.on(RoomEvent.ActiveSpeakersChanged, update);
    room.on(RoomEvent.TrackMuted, update);
    room.on(RoomEvent.TrackUnmuted, update);
    room.on(RoomEvent.TrackPublished, update);
    room.on(RoomEvent.TrackUnpublished, update);
  }

  async function connect() {
    if (roomRef.current) return roomRef.current;
    const ticket = await durakVoiceTokenAction(tableId, guestId());
    if (!ticket.ok) throw new Error(ticket.message);
    const room = new Room();
    bind(room);
    await room.connect(ticket.url, ticket.token);
    await room.localParticipant.setMicrophoneEnabled(false);
    roomRef.current = room;
    return room;
  }

  async function disconnect() {
    setMicOn(false);
    setSelfSpeaking(false);
    setVoices({});
    await roomRef.current?.disconnect();
    roomRef.current = null;
  }

  useEffect(() => {
    return () => {
      void roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, []);

  async function toggleMic() {
    setBusy(true);
    setMessage(null);
    try {
      const room = await connect();
      const next = !micOn;
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
      if (!next && !hearingRef.current) await disconnect();
      else refresh(room);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось подключить голос.");
      await disconnect();
    } finally {
      setBusy(false);
    }
  }

  async function toggleHearing() {
    setBusy(true);
    setMessage(null);
    try {
      const next = !hearingRef.current;
      if (!next) {
        applyHearing(false);
        if (!roomRef.current?.localParticipant.isMicrophoneEnabled) await disconnect();
        return;
      }
      const room = await connect();
      applyHearing(true);
      refresh(room);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось подключить голос.");
      await disconnect();
    } finally {
      setBusy(false);
    }
  }

  return {
    micOn,
    hearing,
    selfSpeaking,
    busy,
    message,
    voices,
    toggleMic: () => void toggleMic(),
    toggleHearing: () => void toggleHearing(),
    audio: <div ref={audioRef} className="hidden" />,
  };
}
