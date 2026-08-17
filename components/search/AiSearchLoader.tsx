"use client";

import { useEffect, useState } from "react";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

export const AI_SEARCH_START_EVENT = "krugi:ai-search-start";
export const AI_SEARCH_END_EVENT = "krugi:ai-search-end";

const OVERLAY_MAX_MS = 20_000;

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

const CARDS: Array<{
  top: string;
  left: string;
  delay: string;
  mark: string;
}> = [
  { top: "8%", left: "4%", delay: "0s", mark: "var(--brand-blue)" },
  { top: "10%", left: "62%", delay: "0.75s", mark: "var(--brand-orange)" },
  { top: "58%", left: "2%", delay: "1.5s", mark: "var(--brand-green)" },
  { top: "62%", left: "60%", delay: "2.25s", mark: "var(--brand-yellow)" },
  { top: "34%", left: "72%", delay: "3s", mark: "var(--brand-red)" },
];

type AiSearchLoaderProps = {
  query: string;
};

export function AiSearchLoader({ query }: AiSearchLoaderProps) {
  const [stage, setStage] = useState(0);
  const q = query.trim();

  useEffect(() => {
    const id = window.setInterval(() => {
      setStage((n) => (n + 1) % STAGES.length);
    }, 1600);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="w-full"
      role="status"
    >
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white px-4 py-6 text-center sm:px-6 sm:py-8">
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

          {CARDS.map((card) => (
            <span
              className="ai-search-card"
              key={`${card.top}-${card.left}`}
              style={{
                top: card.top,
                left: card.left,
                animationDelay: card.delay,
              }}
            >
              <span
                className="ai-search-card__cover"
                style={{ background: card.mark }}
              />
              <span className="ai-search-card__body">
                <span />
                <span />
              </span>
            </span>
          ))}

          <span className="ai-search-pin">
            <BrandPinLoader label="Ищем" pixels={52} />
          </span>
        </div>
      </div>

      <p className="mt-4 text-sm font-medium text-slate-800 sm:mt-5">
        {STAGES[stage]}
      </p>
      {q ? (
        <p className="mx-auto mt-1 max-w-[22rem] truncate text-sm text-slate-500">
          «{q}»
        </p>
      ) : null}
      </div>

      <ul
        aria-hidden
        className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {Array.from({ length: 6 }, (_, i) => (
          <li
            className="ai-search-skel"
            key={i}
            style={{ animationDelay: `${0.18 + i * 0.16}s` }}
          >
            <span className="ai-search-skel__photo" />
            <span className="ai-search-skel__copy">
              <span />
              <span />
              <span />
            </span>
            <span className="ai-search-skel__shine" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Full-screen radar from the moment «Найти» is pressed until results land. */
export function AiSearchOverlay() {
  const [query, setQuery] = useState<string | null>(null);

  useEffect(() => {
    function onStart(event: Event) {
      const detail = (event as CustomEvent<{ query?: string }>).detail;
      setQuery(typeof detail?.query === "string" ? detail.query : "");
    }
    function onEnd() {
      setQuery(null);
    }
    window.addEventListener(AI_SEARCH_START_EVENT, onStart);
    window.addEventListener(AI_SEARCH_END_EVENT, onEnd);
    return () => {
      window.removeEventListener(AI_SEARCH_START_EVENT, onStart);
      window.removeEventListener(AI_SEARCH_END_EVENT, onEnd);
    };
  }, []);

  useEffect(() => {
    if (query === null) return;
    const id = window.setTimeout(() => setQuery(null), OVERLAY_MAX_MS);
    return () => window.clearTimeout(id);
  }, [query]);

  if (query === null) return null;

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="fixed inset-0 z-[1100] overflow-y-auto bg-slate-50"
      role="status"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
        <AiSearchLoader query={query} />
      </div>
    </div>
  );
}
