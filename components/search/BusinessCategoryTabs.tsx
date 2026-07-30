"use client";

import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import type { Category } from "@/types/business";

type Props = {
  categories: Category[];
  categoryCounts: Record<string, number>;
  totalCount: number;
  hubParam?: string | null;
};

function hrefFor(target: "all" | string, hubParam?: string | null): string {
  const q = new URLSearchParams();
  if (hubParam) q.set("hub", hubParam);
  if (target === "all") {
    q.set("view", "all");
    return `/search?${q.toString()}`;
  }
  q.set("category", target);
  return `/search?${q.toString()}`;
}

/**
 * Category icons under the popular slideshow — not text filter chips.
 * Each opens a separate list screen (Все / category).
 */
export function BusinessCategoryTabs({
  categories,
  categoryCounts,
  totalCount,
  hubParam,
}: Props) {
  return (
    <nav aria-label="Категории бизнесов">
      <ul className="grid grid-cols-4 gap-x-2 gap-y-4 sm:grid-cols-5 sm:gap-x-3">
        <li>
          <Link
            href={hrefFor("all", hubParam)}
            className="group flex flex-col items-center gap-1.5 text-center"
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-brand-blue/10 text-brand-blue transition group-hover:bg-brand-blue/15 sm:size-16">
              <LayoutGrid className="size-6 sm:size-7" strokeWidth={1.75} />
            </span>
            <span className="max-w-[4.5rem] text-[11px] leading-tight sm:max-w-[5.5rem] sm:text-xs">
              <span className="block font-medium text-slate-700">Все</span>
              <span className="mt-0.5 block tabular-nums text-slate-400">
                {totalCount}
              </span>
            </span>
          </Link>
        </li>
        {categories.map((cat) => (
          <li key={cat.id}>
            <Link
              href={hrefFor(cat.slug, hubParam)}
              className="group flex flex-col items-center gap-1.5 text-center"
            >
              <span className="flex size-14 items-center justify-center rounded-full bg-slate-100 text-slate-700 transition group-hover:bg-brand-blue/10 group-hover:text-brand-blue sm:size-16">
                <CategoryIcon
                  className="size-6 sm:size-7"
                  slug={cat.slug}
                />
              </span>
              <span className="max-w-[4.5rem] text-[11px] leading-tight sm:max-w-[5.5rem] sm:text-xs">
                <span className="line-clamp-2 block font-medium text-slate-700">
                  {cat.name}
                </span>
                <span className="mt-0.5 block tabular-nums text-slate-400">
                  {categoryCounts[cat.id] ?? 0}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
