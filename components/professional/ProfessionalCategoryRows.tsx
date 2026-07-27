import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ProfessionalCard } from "@/components/professional/ProfessionalCard";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import type { Professional } from "@/types/professional";

const PREVIEW = 4;

export type ProfessionalCategoryRow = {
  slug: string;
  name: string;
  total: number;
  items: Professional[];
};

type ProfessionalCategoryRowsProps = {
  rows: ProfessionalCategoryRow[];
};

export function ProfessionalCategoryRows({ rows }: ProfessionalCategoryRowsProps) {
  if (rows.length === 0) return null;

  return (
    <div className="space-y-10">
      {rows.map((row) => {
        const preview = row.items.slice(0, PREVIEW);
        if (preview.length === 0) return null;
        const href = `/professionals?category=${encodeURIComponent(row.slug)}`;
        const showAll = row.total > preview.length || row.items.length > preview.length;
        return (
          <section className="space-y-3" key={row.slug}>
            <h2 className="flex items-center gap-2 font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
              <CategoryIcon className="size-5 text-slate-500" slug={row.slug} />
              <span className="truncate">{row.name}</span>
              <span className="text-sm font-medium tabular-nums text-slate-400">
                {row.total}
              </span>
            </h2>

            <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {preview.map((p) => (
                <div className="h-full lg:col-span-1" key={p.id}>
                  <ProfessionalCard professional={p} />
                </div>
              ))}
              {showAll ? (
                <Link
                  className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center transition hover:border-brand-blue/40 hover:bg-brand-blue/5 lg:col-span-1"
                  href={href}
                >
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand-blue">
                    Посмотреть все
                    <ChevronRight className="size-4" />
                  </span>
                  <span className="text-xs tabular-nums text-slate-400">
                    {row.total}{" "}
                    {row.total === 1
                      ? "специалист"
                      : row.total >= 2 && row.total <= 4
                        ? "специалиста"
                        : "специалистов"}
                  </span>
                </Link>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
