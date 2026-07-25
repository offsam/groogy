"use client";

import { useEffect, useState } from "react";
import { Monitor, Smartphone, Sparkles } from "lucide-react";
import {
  VIEW_MODE_LABELS,
  VIEW_MODES,
  type ViewMode,
  applyViewMode,
  readStoredViewMode,
  writeStoredViewMode,
} from "@/lib/view-mode";

const VIEW_MODE_EVENT = "rba-view-mode-change";

const ICONS = {
  auto: Sparkles,
  mobile: Smartphone,
  desktop: Monitor,
} as const;

type ViewModeToggleProps = {
  /** Compact fixed control (always visible while scrolling). */
  variant?: "header" | "floating";
};

function broadcast(mode: ViewMode) {
  window.dispatchEvent(new CustomEvent(VIEW_MODE_EVENT, { detail: mode }));
}

export function ViewModeToggle({ variant = "floating" }: ViewModeToggleProps) {
  const [mode, setMode] = useState<ViewMode>("auto");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = readStoredViewMode();
    setMode(stored);
    applyViewMode(stored);
    setReady(true);

    const onChange = (event: Event) => {
      const next = (event as CustomEvent<ViewMode>).detail;
      if (next === "auto" || next === "mobile" || next === "desktop") {
        setMode(next);
      }
    };
    window.addEventListener(VIEW_MODE_EVENT, onChange);
    return () => window.removeEventListener(VIEW_MODE_EVENT, onChange);
  }, []);

  function select(next: ViewMode) {
    setMode(next);
    writeStoredViewMode(next);
    applyViewMode(next);
    broadcast(next);
  }

  const skeletonClass =
    variant === "floating"
      ? "pointer-events-none fixed bottom-4 right-4 z-[1100] h-10 w-[7.5rem] rounded-full bg-slate-200/60"
      : "h-9 w-[7.25rem] rounded-lg bg-slate-100";

  if (!ready) {
    return <div aria-hidden="true" className={skeletonClass} />;
  }

  const shellClass =
    variant === "floating"
      ? "flex items-center gap-0.5 rounded-full border border-slate-200 bg-white/95 p-1 shadow-lg backdrop-blur"
      : "inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5";

  return (
    <div
      className={variant === "floating" ? "fixed bottom-4 right-4 z-[1100]" : undefined}
    >
      <div
        aria-label="Версия сайта"
        className={shellClass}
        role="group"
      >
        {VIEW_MODES.map((value) => {
          const Icon = ICONS[value];
          const active = mode === value;
          return (
            <button
              key={value}
              aria-label={VIEW_MODE_LABELS[value]}
              aria-pressed={active}
              className={
                active
                  ? "inline-flex items-center justify-center gap-1 rounded-md bg-slate-900 px-2 py-1.5 text-xs font-medium text-white"
                  : "inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
              }
              style={active ? { color: "#ffffff" } : undefined}
              title={VIEW_MODE_LABELS[value]}
              type="button"
              onClick={() => select(value)}
            >
              <Icon
                aria-hidden="true"
                className="size-3.5"
                style={active ? { color: "#ffffff" } : undefined}
              />
              {variant === "header" ? null : (
                <span className="hidden sm:inline">{VIEW_MODE_LABELS[value]}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
