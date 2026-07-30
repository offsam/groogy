"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  EVENT_CATEGORIES,
  EVENT_CATEGORY_LABELS_RU,
  type EventCategory,
} from "@/lib/events/categories";
import {
  EVENT_REGIONS,
  type EventRegionId,
  type EventSort,
  type EventWhen,
  serializeEventRegions,
} from "@/lib/events/regions";

type Props = {
  selectedRegions: EventRegionId[];
  sort: EventSort;
  when: EventWhen;
  category: EventCategory | null;
  selectedDate: string | null;
  month: string | null;
  cityCounts: Record<string, number>;
  resultCount: number;
};

function buildHref(opts: {
  regions: EventRegionId[];
  sort: EventSort;
  when: EventWhen;
  category: EventCategory | null;
  date: string | null;
  month: string | null;
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

export function EventsToolbar({
  selectedRegions,
  sort,
  when,
  category,
  selectedDate,
  month,
  cityCounts,
  resultCount,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [regionsOpen, setRegionsOpen] = useState(selectedRegions.length > 0);

  const available = EVENT_REGIONS.filter(
    (r) => (cityCounts[r.city] ?? 0) > 0,
  );

  function navigate(next: {
    regions?: EventRegionId[];
    sort?: EventSort;
    when?: EventWhen;
    category?: EventCategory | null;
  }) {
    const href = buildHref({
      regions: next.regions ?? selectedRegions,
      sort: next.sort ?? sort,
      when: next.when ?? when,
      category: next.category !== undefined ? next.category : category,
      date: selectedDate,
      month,
    });
    startTransition(() => {
      router.push(href);
    });
  }

  function toggleRegion(id: EventRegionId) {
    const set = new Set(selectedRegions);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    navigate({ regions: [...set] });
  }

  const regionLabel =
    selectedRegions.length === 0
      ? "Вся Америка"
      : available
          .filter((r) => selectedRegions.includes(r.id))
          .map((r) => r.label)
          .join(", ") || "Регионы";

  return (
    <div
      className={`space-y-3 ${pending ? "opacity-70" : ""}`}
      aria-busy={pending}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setRegionsOpen(false);
            navigate({ regions: [] });
          }}
          className={`min-h-11 rounded-xl px-3 py-2 text-sm font-medium transition ${
            selectedRegions.length === 0
              ? "bg-brand-blue text-white"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          Вся Америка
        </button>
        <button
          type="button"
          onClick={() => setRegionsOpen((v) => !v)}
          className={`min-h-11 rounded-xl px-3 py-2 text-sm font-medium transition ${
            selectedRegions.length > 0
              ? "bg-brand-blue text-white"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          {selectedRegions.length > 0 ? regionLabel : "Выбрать регионы"}
        </button>

        <label className="ml-auto flex min-h-11 items-center gap-2 text-sm text-slate-600">
          <span className="sr-only sm:not-sr-only">Сортировка</span>
          <select
            className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            value={sort}
            onChange={(e) =>
              navigate({ sort: e.target.value as EventSort })
            }
          >
            <option value="soon">Сначала ближайшие</option>
            <option value="later">Сначала дальние</option>
            <option value="newest">Сначала новые на платформе</option>
          </select>
        </label>
      </div>

      {regionsOpen ? (
        <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-3">
          <p className="w-full text-xs text-slate-500">
            Можно отметить несколько регионов
          </p>
          {available.map((region) => {
            const active = selectedRegions.includes(region.id);
            const count = cityCounts[region.city] ?? 0;
            return (
              <button
                key={region.id}
                type="button"
                onClick={() => toggleRegion(region.id)}
                className={`min-h-11 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  active
                    ? "bg-brand-blue/10 text-brand-blue-deep ring-1 ring-brand-blue/30"
                    : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                }`}
              >
                {region.label}
                <span className="ml-1.5 text-xs text-slate-400">{count}</span>
              </button>
            );
          })}
          {selectedRegions.length > 0 ? (
            <button
              type="button"
              onClick={() => navigate({ regions: [] })}
              className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:text-slate-800"
            >
              Сбросить
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => navigate({ category: null })}
          className={`min-h-11 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
            !category
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          Все занятия
        </button>
        {EVENT_CATEGORIES.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() =>
              navigate({ category: category === id ? null : id })
            }
            className={`min-h-11 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
              category === id
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {EVENT_CATEGORY_LABELS_RU[id]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["all", "Все даты"],
            ["upcoming", "Предстоящие"],
            ["past", "Прошедшие"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => navigate({ when: value })}
            className={`min-h-11 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
              when === value
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-400">
          {resultCount}{" "}
          {resultCount === 1
            ? "событие"
            : resultCount >= 2 && resultCount <= 4
              ? "события"
              : "событий"}
        </span>
      </div>
    </div>
  );
}
