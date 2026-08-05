"use client";

import { cn } from "@/lib/utils";

type Props = {
  done: number;
  total: number;
  percent: number;
  label?: string | null;
  running?: boolean;
  className?: string;
  /** Extra line under the bar (elapsed / ETA / heartbeat). */
  meta?: string | null;
};

export function CatalogJobProgressBar({
  done,
  total,
  percent,
  label,
  running,
  className,
  meta,
}: Props) {
  const pct = Math.min(100, Math.max(0, percent));
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-slate-900">
          {done} / {total}
          <span className="ml-2 font-normal text-slate-500">({pct}%)</span>
        </span>
        {label ? (
          <span className="min-w-0 truncate text-xs text-slate-600">{label}</span>
        ) : null}
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-200/80">
        <div
          className={cn(
            "relative h-full overflow-hidden rounded-full transition-[width] duration-300",
            running ? "bg-brand-blue" : "bg-emerald-600",
          )}
          style={{ width: `${Math.max(pct, running && pct < 2 ? 2 : 0)}%` }}
        >
          {running ? (
            <span
              className="absolute inset-0 animate-pulse bg-white/25"
              aria-hidden
            />
          ) : null}
        </div>
      </div>
      {meta ? (
        <p className="text-[11px] text-slate-500">{meta}</p>
      ) : running ? (
        <p className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-blue/60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-brand-blue" />
          </span>
          Идёт работа…
        </p>
      ) : null}
    </div>
  );
}
