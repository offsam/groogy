"use client";

import { useEffect, useState } from "react";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

const STAGES = [
  "Читаю запрос…",
  "Ищу в каталоге…",
  "Сверяю похожие…",
  "Собираю карточки…",
];

const DOTS: Array<{ top: string; left: string; delay: string; color: string }> = [
  { top: "18%", left: "22%", delay: "0s", color: "var(--brand-blue)" },
  { top: "28%", left: "78%", delay: "0.35s", color: "var(--brand-orange)" },
  { top: "62%", left: "16%", delay: "0.7s", color: "var(--brand-green)" },
  { top: "72%", left: "72%", delay: "1.05s", color: "var(--brand-yellow)" },
  { top: "22%", left: "52%", delay: "0.2s", color: "var(--brand-red)" },
  { top: "78%", left: "46%", delay: "0.9s", color: "var(--brand-blue)" },
];

const CARDS: Array<{
  top: string;
  left: string;
  delay: string;
  mark: string;
}> = [
  { top: "12%", left: "8%", delay: "0s", mark: "var(--brand-blue)" },
  { top: "14%", left: "68%", delay: "0.55s", mark: "var(--brand-orange)" },
  { top: "68%", left: "6%", delay: "1.1s", mark: "var(--brand-green)" },
  { top: "70%", left: "66%", delay: "1.65s", mark: "var(--brand-yellow)" },
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
      className="overflow-hidden rounded-xl border border-slate-200 bg-white px-4 py-8 text-center sm:px-6 sm:py-10"
      role="status"
    >
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
                className="ai-search-card__mark"
                style={{ background: card.mark }}
              />
              <span className="ai-search-card__lines">
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
  );
}
