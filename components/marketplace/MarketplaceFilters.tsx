"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import {
  CONDITION_OPTIONS,
  TRANSACTION_OPTIONS,
} from "@/lib/listings/constants";
import { cn } from "@/lib/utils";

type MarketplaceFiltersProps = {
  categories: Array<{ slug: string; nameRu: string }>;
  total: number;
  hubId: string;
  current: {
    category?: string;
    transactionType?: string;
    condition?: string;
    city?: string;
    minPrice?: string;
    maxPrice?: string;
    sort?: string;
  };
};

function hasActiveFilters(current: MarketplaceFiltersProps["current"]) {
  return Boolean(
    current.category ||
      current.transactionType ||
      current.condition ||
      current.city ||
      current.minPrice ||
      current.maxPrice ||
      (current.sort && current.sort !== "newest"),
  );
}

export function MarketplaceFilters({
  categories,
  total,
  hubId,
  current,
}: MarketplaceFiltersProps) {
  const initiallyOpen = useMemo(() => hasActiveFilters(current), [current]);
  const [open, setOpen] = useState(initiallyOpen);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
        <button
          aria-controls="marketplace-filters-panel"
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 text-lg font-semibold text-slate-900 transition hover:text-slate-700"
          onClick={() => setOpen((v) => !v)}
          type="button"
        >
          Фильтры
          <ChevronDown
            aria-hidden
            className={cn(
              "size-5 text-slate-500 transition",
              open && "rotate-180",
            )}
          />
        </button>
        <p className="text-sm text-slate-500">
          Объявлений:{" "}
          <span className="font-semibold text-slate-900">{total}</span>
        </p>
      </div>

      {open ? (
        <form
          action="/marketplace"
          className="space-y-4 border-t border-slate-100 px-5 pb-5 pt-4 sm:px-6"
          id="marketplace-filters-panel"
          method="get"
        >
          <input name="hub" type="hidden" value={hubId} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block space-y-1.5 text-sm" htmlFor="filter-category">
              <span className="font-medium text-slate-700">Категория</span>
              <select
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
                defaultValue={current.category ?? ""}
                id="filter-category"
                name="category"
              >
                <option value="">Все категории</option>
                {categories.map((cat) => (
                  <option key={cat.slug} value={cat.slug}>
                    {cat.nameRu}
                  </option>
                ))}
              </select>
            </label>

            <label
              className="block space-y-1.5 text-sm"
              htmlFor="filter-transaction"
            >
              <span className="font-medium text-slate-700">Тип сделки</span>
              <select
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
                defaultValue={current.transactionType ?? ""}
                id="filter-transaction"
                name="transactionType"
              >
                <option value="">Любой</option>
                {TRANSACTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5 text-sm" htmlFor="filter-condition">
              <span className="font-medium text-slate-700">Состояние</span>
              <select
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
                defaultValue={current.condition ?? ""}
                id="filter-condition"
                name="condition"
              >
                <option value="">Любое</option>
                {CONDITION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5 text-sm" htmlFor="filter-city">
              <span className="font-medium text-slate-700">Город</span>
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
                defaultValue={current.city ?? ""}
                id="filter-city"
                name="city"
                placeholder="Например, Brooklyn"
              />
            </label>

            <label className="block space-y-1.5 text-sm" htmlFor="filter-minPrice">
              <span className="font-medium text-slate-700">Цена от ($)</span>
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
                defaultValue={current.minPrice ?? ""}
                id="filter-minPrice"
                min={0}
                name="minPrice"
                step="1"
                type="number"
              />
            </label>

            <label className="block space-y-1.5 text-sm" htmlFor="filter-maxPrice">
              <span className="font-medium text-slate-700">Цена до ($)</span>
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
                defaultValue={current.maxPrice ?? ""}
                id="filter-maxPrice"
                min={0}
                name="maxPrice"
                step="1"
                type="number"
              />
            </label>

            <label
              className="block space-y-1.5 text-sm sm:col-span-2 lg:col-span-1"
              htmlFor="filter-sort"
            >
              <span className="font-medium text-slate-700">Сортировка</span>
              <select
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
                defaultValue={current.sort ?? "newest"}
                id="filter-sort"
                name="sort"
              >
                <option value="newest">Сначала новые</option>
                <option value="price_asc">Цена ↑</option>
                <option value="price_desc">Цена ↓</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
              type="submit"
            >
              Применить
            </button>
            <Link
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900"
              href={`/marketplace?hub=${encodeURIComponent(hubId)}`}
            >
              Сбросить
            </Link>
          </div>
        </form>
      ) : null}
    </div>
  );
}
