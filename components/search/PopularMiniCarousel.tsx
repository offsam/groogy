"use client";

import { useEffect, useMemo, useState } from "react";
import type { Business } from "@/types/business";
import { BusinessMiniCard } from "./BusinessMiniCard";

const PAGE_SIZE = 2;
const ROTATE_MS = 4500;

type Props = {
  businesses: Business[];
};

function popularityScore(b: Business): number {
  const reviews = b.reviewsCount ?? 0;
  const rating = b.ratingAvg ?? 0;
  return reviews * 10 + rating * 20;
}

/** Top popular businesses as mini cards; pages of 2 rotate in the upper area. */
export function PopularMiniCarousel({ businesses }: Props) {
  const popular = useMemo(() => {
    return [...businesses]
      .sort((a, b) => popularityScore(b) - popularityScore(a))
      .slice(0, 8);
  }, [businesses]);

  const pages = useMemo(() => {
    const chunks: Business[][] = [];
    for (let i = 0; i < popular.length; i += PAGE_SIZE) {
      chunks.push(popular.slice(i, i + PAGE_SIZE));
    }
    return chunks.length > 0 ? chunks : [[]];
  }, [popular]);

  const [page, setPage] = useState(0);

  useEffect(() => {
    if (pages.length <= 1) return;
    const id = window.setInterval(() => {
      setPage((p) => (p + 1) % pages.length);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [pages.length]);

  if (popular.length === 0) return null;

  const current = pages[page] ?? pages[0];

  return (
    <section className="space-y-3" aria-label="Популярное">
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-800">Популярное</h2>
        {pages.length > 1 ? (
          <p className="text-[11px] tabular-nums text-slate-400">
            {page + 1}/{pages.length}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {current.map((b) => (
          <BusinessMiniCard key={b.id} business={b} />
        ))}
        {current.length < PAGE_SIZE
          ? Array.from({ length: PAGE_SIZE - current.length }).map((_, i) => (
              <div key={`pad-${i}`} className="invisible" aria-hidden />
            ))
          : null}
      </div>
      {pages.length > 1 ? (
        <div className="flex justify-center gap-1.5">
          {pages.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Страница ${i + 1}`}
              aria-current={i === page ? "true" : undefined}
              onClick={() => setPage(i)}
              className={`h-1.5 rounded-full transition ${
                i === page ? "w-5 bg-brand-blue" : "w-1.5 bg-slate-300"
              }`}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
