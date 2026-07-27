"use client";

import Link from "next/link";
import { BusinessCard } from "@/components/business/BusinessCard";
import { ProfessionalCard } from "@/components/professional/ProfessionalCard";
import type { DirectorySourceMeta } from "@/lib/import-review/directory-sources";
import { directorySourceHref } from "@/lib/import-review/directory-sources";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";
import {
  yellowPagesEntityKind,
  yellowPagesToBusinessPreview,
  yellowPagesToProfessionalPreview,
} from "@/lib/import-review/yellow-pages-preview";

type Props = {
  source: DirectorySourceMeta;
  items: CommentRecommendation[];
  total: number;
  status: string;
};

export function DirectorySourcePanel({ source, items, total, status }: Props) {
  const pendingHref = directorySourceHref(source.slug, "pending");
  const allHref = directorySourceHref(source.slug, "all");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {total}{" "}
          {total === 1 ? "карточка" : total >= 2 && total <= 4 ? "карточки" : "карточек"}
          {" · "}
          превью как на сайте (бизнес / профи)
        </p>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href={pendingHref}
            className={
              status === "pending"
                ? "font-semibold text-brand-blue"
                : "text-slate-500 hover:text-brand-blue"
            }
          >
            Pending
          </Link>
          <span className="text-slate-300">·</span>
          <Link
            href={allHref}
            className={
              status === "all"
                ? "font-semibold text-brand-blue"
                : "text-slate-500 hover:text-brand-blue"
            }
          >
            Все статусы
          </Link>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          Нет карточек из {source.shortTitle}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const kind = yellowPagesEntityKind(item);
            const sourceUrl = item.source_post_urls[0];
            return (
              <div key={item.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 px-0.5">
                  <span className="rounded-md bg-brand-yellow/25 px-2 py-0.5 text-[11px] font-semibold text-amber-950">
                    {source.shortTitle}
                  </span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                    {kind === "professional" ? "профи" : "бизнес"}
                  </span>
                  {item.city ? (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                      {item.city}
                    </span>
                  ) : null}
                  {item.category_guess ? (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                      {item.category_guess}
                    </span>
                  ) : null}
                </div>

                {kind === "professional" ? (
                  <ProfessionalCard
                    professional={yellowPagesToProfessionalPreview(item)}
                    preview
                  />
                ) : (
                  <BusinessCard
                    business={yellowPagesToBusinessPreview(item)}
                    preview
                  />
                )}

                {sourceUrl ? (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-xs text-brand-blue hover:underline"
                  >
                    Источник →
                  </a>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
