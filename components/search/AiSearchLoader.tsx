"use client";

import { useEffect, useRef, useState } from "react";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";
import { cn } from "@/lib/utils";

export const AI_SEARCH_START_EVENT = "krugi:ai-search-start";
export const AI_SEARCH_END_EVENT = "krugi:ai-search-end";

const OVERLAY_MAX_MS = 20_000;
/** Must match the transition duration on .ai-search-radar-fly in globals.css. */
const EXIT_MS = 560;

/** Survives layout remounts during / → /search. */
let searchBusy = false;
let searchQuery = "";

/** Show the radar immediately — before the search route paints. */
export function signalAiSearch(query: string): void {
  if (typeof window === "undefined") return;
  searchBusy = true;
  searchQuery = query.trim().slice(0, 2000);
  document.body.classList.add("ai-search-active");
  window.dispatchEvent(
    new CustomEvent(AI_SEARCH_START_EVENT, {
      detail: { query: searchQuery },
    }),
  );
}

export function endAiSearch(): void {
  if (typeof window === "undefined") return;
  searchBusy = false;
  document.body.classList.remove("ai-search-active");
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
    <div className="ai-search-radar-front text-center">
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

type FlyTo = { dx: number; dy: number; scale: number };

/**
 * Floating radar docked near the header search bar — never a full-screen
 * layer. The real page (home hero, then /search with its own skeleton/real
 * card grid) stays visible underneath the whole time, so there is no
 * separate view to switch away from. On finish it flies to and fades into
 * the header search bar instead of just disappearing.
 */
export function AiSearchOverlay() {
  const [query, setQuery] = useState(searchQuery);
  const [open, setOpen] = useState(searchBusy);
  const [exiting, setExiting] = useState(false);
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null);
  const [headerH, setHeaderH] = useState(72);
  const dockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function beginExit() {
      const dock = dockRef.current;
      const anchor = document.querySelector<HTMLElement>(
        "[data-ai-search-anchor]",
      );
      if (dock && anchor) {
        const r = dock.getBoundingClientRect();
        const a = anchor.getBoundingClientRect();
        setFlyTo({
          dx: a.left + a.width / 2 - (r.left + r.width / 2),
          dy: a.top + a.height / 2 - (r.top + r.height / 2),
          scale: Math.max(
            0.15,
            Math.min(0.34, a.height / Math.max(r.height, 1)),
          ),
        });
      } else {
        setFlyTo({ dx: 0, dy: -24, scale: 0.2 });
      }
      setExiting(true);
      window.setTimeout(() => {
        setOpen(false);
        setExiting(false);
        setFlyTo(null);
      }, EXIT_MS);
    }

    function onStart(event: Event) {
      const detail = (event as CustomEvent<{ query?: string }>).detail;
      setQuery(typeof detail?.query === "string" ? detail.query : searchQuery);
      setExiting(false);
      setFlyTo(null);
      setOpen(true);
    }
    function onEnd() {
      beginExit();
    }
    window.addEventListener(AI_SEARCH_START_EVENT, onStart);
    window.addEventListener(AI_SEARCH_END_EVENT, onEnd);
    if (searchBusy) {
      setQuery(searchQuery);
      setOpen(true);
    }
    return () => {
      window.removeEventListener(AI_SEARCH_START_EVENT, onStart);
      window.removeEventListener(AI_SEARCH_END_EVENT, onEnd);
    };
  }, []);

  useEffect(() => {
    if (!open || exiting) return;
    const id = window.setTimeout(() => {
      endAiSearch();
    }, OVERLAY_MAX_MS);
    return () => window.clearTimeout(id);
  }, [open, exiting, query]);

  useEffect(() => {
    if (!open) return;
    const header = document.querySelector("header");
    function sync() {
      setHeaderH(header ? Math.ceil(header.getBoundingClientRect().height) : 72);
    }
    sync();
    const ro = header ? new ResizeObserver(sync) : null;
    if (header && ro) ro.observe(header);
    window.addEventListener("resize", sync);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={dockRef}
      aria-busy={!exiting}
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed inset-x-0 z-[1000] flex justify-center px-4",
        exiting && "ai-search-radar-fly",
      )}
      role="status"
      style={{
        top: headerH + 16,
        ...(exiting && flyTo
          ? {
              transform: `translate(${flyTo.dx}px, ${flyTo.dy}px) scale(${flyTo.scale})`,
              opacity: 0,
            }
          : undefined),
      }}
    >
      <AiSearchRadar query={query} />
    </div>
  );
}
