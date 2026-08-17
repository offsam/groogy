"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type PopularQuery = {
  query: string;
  hits: number;
};

export function PopularSearchQueries() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [queries, setQueries] = useState<PopularQuery[] | null>(null);

  useEffect(() => {
    if (!open || queries !== null) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/search/popular");
        const data = (await res.json()) as { queries?: PopularQuery[] };
        if (!cancelled) setQueries(data.queries ?? []);
      } catch {
        if (!cancelled) setQueries([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, queries]);

  return (
    <div className="w-full">
      <button
        type="button"
        className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 sm:w-auto"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "Скрыть топ-50 запросов" : "Посмотреть топ-50 запросов"}
      </button>
      {open ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
          <p className="text-sm font-medium text-slate-800">
            Что чаще всего ищут
          </p>
          {loading ? (
            <p className="mt-2 text-sm text-slate-500">Загружаем…</p>
          ) : !queries || queries.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              Пока мало поисков, чтобы показать топ. Список появится, когда
              люди начнут искать.
            </p>
          ) : (
            <ol className="mt-3 space-y-1">
              {queries.map((item, index) => (
                <li key={item.query}>
                  <Link
                    href={`/search?q=${encodeURIComponent(item.query)}`}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm text-slate-800 hover:bg-white"
                  >
                    <span className="min-w-0 truncate">
                      <span className="tabular-nums text-slate-400">
                        {index + 1}.
                      </span>{" "}
                      {item.query}
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-400">
                      {item.hits}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </div>
  );
}
