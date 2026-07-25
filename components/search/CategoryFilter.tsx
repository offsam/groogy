"use client";

import { cn } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import type { Category } from "@/types/business";

type CategoryFilterProps = {
  categories: Category[];
  selected: string | null;
  onChange: (slug: string | null) => void;
};

export function CategoryFilter({ categories, selected, onChange }: CategoryFilterProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Фильтр по категориям">
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
          onClick={() => onChange(selected === category.slug ? null : category.slug)}
          type="button"
        >
          <CategoryIcon className="size-3.5" slug={category.slug} />
          {category.name}
        </button>
      ))}
    </div>
  );
}
