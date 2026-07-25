"use client";

import { cn } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { BUSINESS_QUICK_FILTERS } from "@/lib/platform/sections";
import type { Category } from "@/types/business";

type CategoryFilterProps = {
  categories: Category[];
  selected: string | null;
  onChange: (slug: string | null) => void;
};

export function CategoryFilter({
  categories,
  selected,
  onChange,
}: CategoryFilterProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
          Быстрый фильтр
        </p>
        <div
          aria-label="Быстрый фильтр"
          className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="group"
        >
          {BUSINESS_QUICK_FILTERS.map((filter) => {
            const active = selected === filter.slug;
            return (
              <button
                key={filter.slug}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "border-brand-blue bg-brand-blue text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-400",
                )}
                onClick={() => onChange(active ? null : filter.slug)}
                type="button"
              >
                <CategoryIcon className="size-3.5" slug={filter.slug} />
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
          Категории
        </p>
        <div
          aria-label="Категории бизнесов"
          className="flex flex-wrap gap-2"
          role="group"
        >
          <button
            className={cn(
              "shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
              selected === null
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-400",
            )}
            onClick={() => onChange(null)}
            type="button"
          >
            Все
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
                selected === category.slug
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-400",
              )}
              onClick={() =>
                onChange(selected === category.slug ? null : category.slug)
              }
              type="button"
            >
              <CategoryIcon className="size-3.5" slug={category.slug} />
              {category.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
