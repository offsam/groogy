"use client";

import { useEffect, useState } from "react";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";
import { cn } from "@/lib/utils";

export const AI_SEARCH_START_EVENT = "krugi:ai-search-start";
export const AI_SEARCH_END_EVENT = "krugi:ai-search-end";

const OVERLAY_MAX_MS = 20_000;
const FADE_MS = 480;

/** Show the radar overlay immediately — before the search route paints. */
export function signalAiSearch(query: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(AI_SEARCH_START_EVENT, {
      detail: { query: query.trim().slice(0, 2000) },
    }),
  );
}

export function endAiSearch(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AI_SEARCH_END_EVENT));
}

const STAGES = [
  "Читаю запрос…",
  "Ищу в каталоге…",
  "Сверяю похожие…",
  "Собираю карточки…",
];

const DOTS: Array<{ top: string; left: string; delay: string; color: string }> = [
  { top: "16%", left: "24%", delay: "0s", color: "var(--brand-blue)" },
  { top: "26%", left: "78%", delay: "0.28s", color: "var(--brand-orange)" },
  { top: "48%", left: "12%", delay: "0.55s", color: "var(--brand-green)" },
  { top: "44%", left: "86%", delay: "0.82s", color: "var(--brand-yellow)" },
  { top: "68%", left: "20%", delay: "1.1s", color: "var(--brand-red)" },
  { top: "74%", left: "72%", delay: "1.38s", color: "var(--brand-blue)" },
  { top: "18%", left: "52%", delay: "0.4s", color: "var(--brand-green)" },
  { top: "82%", left: "48%", delay: "1.6s", color: "var(--brand-orange)" },
];

type AiSearchRadarProps = {
  query: string;
};

export function AiSearchRadar({ query }: AiSearchRadarProps) {
  const [stage, setStage] = useState(0);
  const q = query.trim();

  useEffect(() => {
    const id = window.setInterval(() => {
      setStage((n) => (n + 1) % STAGES.length);
    }, 1600);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="ai-search-radar-front pointer-events-none text-center">
      <div className="ai-search-scene" aria-hidden>
        <div className="ai-search-field">
          <span className="ai-search-ring" />
          <span className="ai-search-ring" />
          <span className="ai-search-ring" />

          {DOTS.map((dot) => (
            <span
              className="ai-search-dot"
              key={`${dot.top}-${dot.left}`}
              style={{
                top: dot.top,
                left: dot.left,
                background: dot.color,
                color: dot.color,
                animationDelay: dot.delay,
              }}
            />
          ))}

          <span className="ai-search-pin">
            <BrandPinLoader label="Ищем" pixels={52} />
          </span>
        </div>
      </div>
      <p className="mt-2 text-sm font-medium text-slate-800">{STAGES[stage]}</p>
      {q ? (
        <p className="mx-auto mt-0.5 max-w-[22rem] truncate text-sm text-slate-500">
          «{q}»
        </p>
      ) : null}
    </div>
  );
}

/** Radar in front of the result tiles until search finishes. */
export function AiSearchOverlay() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onStart(event: Event) {
      const detail = (event as CustomEvent<{ query?: string }>).detail;
      setQuery(typeof detail?.query === "string" ? detail.query : "");
      setOpen(true);
    }
    function onEnd() {
      setOpen(false);
    }
    window.addEventListener(AI_SEARCH_START_EVENT, onStart);
    window.addEventListener(AI_SEARCH_END_EVENT, onEnd);
    return () => {
      window.removeEventListener(AI_SEARCH_START_EVENT, onStart);
      window.removeEventListener(AI_SEARCH_END_EVENT, onEnd);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => setOpen(false), OVERLAY_MAX_MS);
    return () => window.clearTimeout(id);
  }, [open, query]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const id = window.setTimeout(() => setMounted(false), FADE_MS);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!mounted && !open) return null;

  return (
    <div
      aria-busy={open}
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed inset-0 z-[1100] flex items-center justify-center transition-opacity duration-500",
        open ? "opacity-100" : "opacity-0",
      )}
      role="status"
    >
      <AiSearchRadar query={query} />
    </div>
  );
}
