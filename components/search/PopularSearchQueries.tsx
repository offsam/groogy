"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type PopularQuery = {
  query: string;
  hits: number;
};

type PopularSearchQueriesProps = {
  tone?: "light" | "dark";
};

export function PopularSearchQueries({ tone = "light" }: PopularSearchQueriesProps) {
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
    <div className="relative w-full">
      <button
        type="button"
        className={cn(
          "inline-flex min-h-11 w-full items-center justify-center rounded-xl border px-4 text-sm font-medium sm:w-auto",
          tone === "dark"
            ? "border-white/35 bg-white/15 text-white hover:bg-white/25"
            : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
        )}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "Скрыть топ-50 запросов" : "Посмотреть топ-50 запросов"}
      </button>
      {open ? (
        <div
          className={cn(
            "absolute left-0 right-0 z-30 mt-2 max-h-72 overflow-y-auto overflow-x-hidden rounded-xl border p-3 shadow-lg sm:right-auto sm:w-[min(22rem,calc(100vw-1.5rem))] sm:p-4",
            tone === "dark"
              ? "border-white/20 bg-slate-950/95 text-white"
              : "border-slate-200 bg-white text-slate-800",
          )}
        >
          <p
            className={cn(
              "text-sm font-medium",
              tone === "dark" ? "text-white" : "text-slate-800",
            )}
          >
            Что чаще всего ищут
          </p>
          {loading ? (
            <p
              className={cn(
                "mt-2 text-sm",
                tone === "dark" ? "text-white/70" : "text-slate-500",
              )}
            >
              Загружаем…
            </p>
          ) : !queries || queries.length === 0 ? (
            <p
              className={cn(
                "mt-2 text-sm",
                tone === "dark" ? "text-white/70" : "text-slate-500",
              )}
            >
              Пока мало поисков, чтобы показать топ. Список появится, когда
              люди начнут искать.
            </p>
          ) : (
            <ol className="mt-3 space-y-1">
              {queries.map((item, index) => (
                <li key={item.query}>
                  <Link
                    href={`/search?q=${encodeURIComponent(item.query)}`}
                    className={cn(
                      "flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm",
                      tone === "dark"
                        ? "text-white hover:bg-white/10"
                        : "text-slate-800 hover:bg-slate-50",
                    )}
                    onClick={() => setOpen(false)}
                  >
                    <span className="min-w-0 truncate">
                      <span
                        className={cn(
                          "tabular-nums",
                          tone === "dark" ? "text-white/45" : "text-slate-400",
                        )}
                      >
                        {index + 1}.
                      </span>{" "}
                      {item.query}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 tabular-nums",
                        tone === "dark" ? "text-white/45" : "text-slate-400",
                      )}
                    >
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
