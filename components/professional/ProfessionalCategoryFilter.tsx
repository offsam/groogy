"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { PROFESSIONAL_CATEGORY_SLUGS } from "@/lib/professional/categories";
import type { Category } from "@/types/business";

type ProfessionalCategoryFilterProps = {
  categories: Category[];
  selected: string | null;
  counts?: Record<string, number>;
};

export function ProfessionalCategoryFilter({
  categories,
  selected,
  counts,
}: ProfessionalCategoryFilterProps) {
  const allowed = new Set<string>(PROFESSIONAL_CATEGORY_SLUGS);
  const bySlug = new Map(categories.map((c) => [c.slug, c]));
  const items = PROFESSIONAL_CATEGORY_SLUGS.map((slug) => bySlug.get(slug)).filter(
    (c): c is Category => Boolean(c) && allowed.has(c.slug),
  );

  return (
    <div
      aria-label="Сферы деятельности"
      className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="group"
    >
      <Link
        className={cn(
          "inline-flex shrink-0 items-center rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
          !selected
            ? "border-brand-blue bg-brand-blue text-white"
            : "border-slate-200 bg-white text-slate-600 hover:border-slate-400",
        )}
        href="/professionals"
        scroll={false}
      >
        Все
      </Link>
      {items.map((cat) => {
        const active = selected === cat.slug;
        const n = counts?.[cat.slug];
        return (
          <Link
            key={cat.id}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              active
                ? "border-brand-blue bg-brand-blue text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-400",
            )}
            href={`/professionals?category=${encodeURIComponent(cat.slug)}`}
            scroll={false}
          >
            <CategoryIcon className="size-3.5" slug={cat.slug} />
            {cat.name}
            {typeof n === "number" && n > 0 ? (
              <span
                className={cn(
                  "tabular-nums text-xs",
                  active ? "text-white/80" : "text-slate-400",
                )}
              >
                {n}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
