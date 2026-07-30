"use client";

import { useRouter } from "next/navigation";
import { useMemo, useTransition } from "react";
import {
  serializeEventRegions,
  type EventRegionId,
  type EventSort,
  type EventWhen,
  weekendRangeFrom,
} from "@/lib/events/regions";
import type { EventCategory } from "@/lib/events/categories";

type Props = {
  selectedDate: string | null;
  month: string; // YYYY-MM
  dateCounts: Record<string, number>;
  selectedRegions: EventRegionId[];
  sort: EventSort;
  when: EventWhen;
  category: EventCategory | null;
};

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function buildHref(opts: {
  regions: EventRegionId[];
  sort: EventSort;
  when: EventWhen;
  category: EventCategory | null;
  date: string | null;
  month?: string;
}): string {
  const params = new URLSearchParams();
  if (opts.regions.length > 0) {
    params.set("regions", serializeEventRegions(opts.regions));
  }
  if (opts.sort !== "soon") params.set("sort", opts.sort);
  if (opts.when !== "all") params.set("when", opts.when);
  if (opts.category) params.set("category", opts.category);
  if (opts.date) params.set("date", opts.date);
  if (opts.month) params.set("month", opts.month);
  const qs = params.toString();
  return qs ? `/events?${qs}` : "/events";
}

function daysInMonthGrid(monthYmd: string): Array<{
  ymd: string | null;
  day: number | null;
}> {
  const [y, m] = monthYmd.split("-").map(Number);
  const first = new Date(Date.UTC(y!, m! - 1, 1));
  // Monday-first: JS getUTCDay Sun=0 → shift
  const startDow = (first.getUTCDay() + 6) % 7;
  const daysCount = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const cells: Array<{ ymd: string | null; day: number | null }> = [];
  for (let i = 0; i < startDow; i++) cells.push({ ymd: null, day: null });
  for (let d = 1; d <= daysCount; d++) {
    const ymd = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ ymd, day: d });
  }
  while (cells.length % 7 !== 0) cells.push({ ymd: null, day: null });
  return cells;
}

function shiftMonth(monthYmd: string, delta: number): string {
  const [y, m] = monthYmd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabelRu(monthYmd: string): string {
  const [y, m] = monthYmd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, 1));
  return dt.toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function EventsCalendar({
  selectedDate,
  month,
  dateCounts,
  selectedRegions,
  sort,
  when,
  category,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const cells = useMemo(() => daysInMonthGrid(month), [month]);

  function go(next: {
    date?: string | null;
    month?: string;
    clearDate?: boolean;
  }) {
    const href = buildHref({
      regions: selectedRegions,
      sort,
      when,
      category,
      date: next.clearDate ? null : (next.date ?? selectedDate),
      month: next.month,
    });
    startTransition(() => {
      router.push(href);
    });
  }

  function pickWeekend() {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const { start } = weekendRangeFrom(today);
    go({ date: start, month: start.slice(0, 7) });
  }

  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 ${
        pending ? "opacity-70" : ""
      }`}
      aria-busy={pending}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => go({ month: shiftMonth(month, -1), clearDate: false })}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50"
            aria-label="Предыдущий месяц"
          >
            ‹
          </button>
          <h2 className="min-w-[9rem] text-center text-sm font-semibold capitalize text-slate-900 sm:text-base">
            {monthLabelRu(month)}
          </h2>
          <button
            type="button"
            onClick={() => go({ month: shiftMonth(month, 1), clearDate: false })}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50"
            aria-label="Следующий месяц"
          >
            ›
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              const today = new Intl.DateTimeFormat("en-CA", {
                timeZone: "America/Los_Angeles",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              }).format(new Date());
              go({ date: today, month: today.slice(0, 7) });
            }}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Сегодня
          </button>
          <button
            type="button"
            onClick={pickWeekend}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Выходные
          </button>
          {selectedDate ? (
            <button
              type="button"
              onClick={() => go({ clearDate: true })}
              className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200"
            >
              Все дни
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wide text-slate-400 sm:text-xs">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, i) => {
          if (!cell.ymd || cell.day == null) {
            return <div key={`e-${i}`} className="aspect-square" />;
          }
          const count = dateCounts[cell.ymd] ?? 0;
          const selected = selectedDate === cell.ymd;
          return (
            <button
              key={cell.ymd}
              type="button"
              onClick={() => go({ date: cell.ymd })}
              className={`flex aspect-square flex-col items-center justify-center rounded-xl text-sm transition ${
                selected
                  ? "bg-brand-blue text-white"
                  : count > 0
                    ? "bg-brand-blue/10 text-brand-blue-deep hover:bg-brand-blue/15"
                    : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <span className="font-semibold">{cell.day}</span>
              {count > 0 ? (
                <span
                  className={`text-[10px] leading-none ${
                    selected ? "text-white/80" : "text-brand-blue"
                  }`}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
