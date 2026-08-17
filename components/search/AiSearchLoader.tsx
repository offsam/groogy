"use client";

import { useEffect, useState } from "react";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";
import { SearchPendingTiles } from "@/components/search/SearchPendingTiles";
import { cn } from "@/lib/utils";

export const AI_SEARCH_START_EVENT = "krugi:ai-search-start";
export const AI_SEARCH_END_EVENT = "krugi:ai-search-end";

const OVERLAY_MAX_MS = 20_000;
const FADE_MS = 480;

/** Survives layout remounts during / → /search. */
let searchBusy = false;
let searchQuery = "";

/** Show the radar overlay immediately — before the search route paints. */
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

/** Equal-size result tiles behind the radar; header search stays visible. */
export function AiSearchOverlay() {
  const [query, setQuery] = useState(searchQuery);
  const [open, setOpen] = useState(searchBusy);
  const [headerH, setHeaderH] = useState(72);

  useEffect(() => {
    function onStart(event: Event) {
      const detail = (event as CustomEvent<{ query?: string }>).detail;
      setQuery(typeof detail?.query === "string" ? detail.query : searchQuery);
      setOpen(true);
    }
    function onEnd() {
      setOpen(false);
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
    if (!open) return;
    const id = window.setTimeout(() => {
      searchBusy = false;
      document.body.classList.remove("ai-search-active");
      setOpen(false);
    }, OVERLAY_MAX_MS);
    return () => window.clearTimeout(id);
  }, [open, query]);

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

  const [mounted, setMounted] = useState(searchBusy);
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
        "fixed inset-0 z-[1000] bg-white transition-opacity duration-500",
        open ? "opacity-100" : "opacity-0 pointer-events-none",
      )}
      role="status"
      style={{ paddingTop: headerH }}
    >
      <div className="mx-auto h-full w-full max-w-6xl overflow-y-auto px-4 py-4 sm:py-5">
        <div className="relative">
          <SearchPendingTiles />
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <AiSearchRadar query={query} />
          </div>
        </div>
      </div>
    </div>
  );
}
