"use client";

import { useEffect, useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "krugi-mobile-preview";
const FRAME_PARAM = "mobileFrame";

/** One typical phone viewport — layout stays fluid for other sizes. */
const PHONE_W = 390;
const PHONE_H = 844;

function isFrameEmbed(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get(FRAME_PARAM) === "1";
}

function frameSrc(): string {
  const url = new URL(window.location.href);
  url.searchParams.set(FRAME_PARAM, "1");
  return url.toString();
}

/**
 * Desktop-only: one phone-shaped iframe (real aspect ratio).
 * Nested loads with ?mobileFrame=1 skip this chrome.
 */
export function MobilePreview() {
  const [ready, setReady] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [embedded, setEmbedded] = useState(false);
  const [on, setOn] = useState(false);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (isFrameEmbed()) {
      setEmbedded(true);
      setReady(true);
      return;
    }

    const mq = window.matchMedia("(min-width: 768px)");
    const syncDesktop = () => setDesktop(mq.matches);
    syncDesktop();
    mq.addEventListener("change", syncDesktop);

    const enabled = window.localStorage.getItem(STORAGE_KEY) === "1";
    setOn(enabled);
    if (mq.matches && enabled) setSrc(frameSrc());
    setReady(true);

    return () => mq.removeEventListener("change", syncDesktop);
  }, []);

  useEffect(() => {
    if (!ready || embedded || !desktop) return;
    setSrc(on ? frameSrc() : null);
  }, [desktop, embedded, on, ready]);

  function toggle() {
    const next = !on;
    setOn(next);
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  }

  if (!ready || embedded || !desktop) return null;

  return (
    <>
      {on && src ? (
        <div
          aria-label="Превью мобильной версии"
          className="fixed inset-0 z-[1999] flex items-center justify-center bg-slate-950/95 p-6 pb-24"
        >
          <div
            className="relative overflow-hidden rounded-[2rem] border-[10px] border-slate-800 bg-black shadow-2xl shadow-black/50"
            style={{
              // Fit within the window while keeping a real phone aspect ratio.
              width: `min(${PHONE_W}px, calc(100vw - 3rem), calc((100vh - 7.5rem) * ${PHONE_W} / ${PHONE_H}))`,
              aspectRatio: `${PHONE_W} / ${PHONE_H}`,
              height: "auto",
            }}
          >
            <iframe
              className="absolute inset-0 size-full border-0 bg-white"
              src={src}
              title="Мобильная версия"
            />
          </div>
        </div>
      ) : null}

      <button
        aria-pressed={on}
        className={cn(
          "fixed bottom-4 right-4 z-[2000] inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold shadow-lg transition",
          "font-[family-name:var(--font-sans)]",
          on
            ? "border-slate-700 bg-slate-900 text-white hover:bg-slate-800"
            : "border-slate-200 bg-white/95 text-slate-800 shadow-slate-900/10 backdrop-blur hover:bg-white",
        )}
        onClick={toggle}
        type="button"
      >
        {on ? (
          <>
            <Monitor aria-hidden className="size-4" />
            Десктоп
          </>
        ) : (
          <>
            <Smartphone aria-hidden className="size-4" />
            Мобильная версия
          </>
        )}
      </button>
    </>
  );
}
