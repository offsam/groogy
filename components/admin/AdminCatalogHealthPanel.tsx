"use client";

import { useState, useTransition } from "react";
import {
  probeCatalogHealthAction,
  revalidateCatalogAggregatesAction,
  type CatalogHealthSnapshot,
} from "@/lib/admin/catalog-health-actions";
import {
  ALL_CATALOG_CACHE_TAGS,
  CATALOG_CACHE_TTL,
} from "@/lib/platform/catalog-cache";
import { PLATFORM_SECTIONS } from "@/lib/platform/sections";
import { cn } from "@/lib/utils";

function formatMs(ms: number) {
  return `${ms.toLocaleString("ru-RU")} ms`;
}

export function AdminCatalogHealthPanel() {
  const [pending, startTransition] = useTransition();
  const [snapshot, setSnapshot] = useState<CatalogHealthSnapshot | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function runProbe() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await probeCatalogHealthAction();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSnapshot(result.snapshot);
      setMessage("Замеры обновлены (без кэша Next).");
    });
  }

  function runRevalidate() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await revalidateCatalogAggregatesAction();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(result.message ?? "Кэш сброшен.");
    });
  }

  const counts = snapshot?.counts;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={runProbe}
          disabled={pending}
          className="min-h-11 rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
        >
          {pending ? "Считаем…" : "Замерить latency"}
        </button>
        <button
          type="button"
          onClick={runRevalidate}
          disabled={pending}
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
        >
          Сбросить кэш агрегатов
        </button>
      </div>

      {message ? (
        <p className="text-sm text-brand-green">{message}</p>
      ) : null}
      {error ? <p className="text-sm text-brand-red">{error}</p> : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Кэш агрегатов</h2>
        <p className="mt-1 text-xs text-slate-500">
          TTL и теги для главной / API. После пачки публикаций — «Сбросить кэш».
        </p>
        <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
          {ALL_CATALOG_CACHE_TAGS.map((tag) => {
            const ttl =
              tag === "hub-resource-stats"
                ? CATALOG_CACHE_TTL.hubResourceStats
                : tag === "popular-home"
                  ? CATALOG_CACHE_TTL.popularHome
                  : tag === "home-map-pins"
                    ? CATALOG_CACHE_TTL.homeMapPins
                    : CATALOG_CACHE_TTL.hubCategoryCounts;
            return (
              <li key={tag} className="flex flex-wrap gap-x-3 gap-y-0.5">
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                  {tag}
                </code>
                <span className="tabular-nums text-slate-500">{ttl}s</span>
              </li>
            );
          })}
        </ul>
      </section>

      {counts ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Снимок каталога (exact count)
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {PLATFORM_SECTIONS.map((section) => (
              <li
                key={section.key}
                className="flex items-baseline justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"
              >
                <span className="text-slate-600">{section.title}</span>
                <span className="font-semibold tabular-nums text-slate-900">
                  {(counts[section.key] ?? 0).toLocaleString("ru-RU")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {snapshot ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">
              Latency probes
            </h2>
            <p className="text-xs text-slate-500">
              {new Date(snapshot.probedAt).toLocaleString("ru-RU")}
            </p>
          </div>
          <ul className="mt-3 divide-y divide-slate-100">
            {snapshot.probes.map((probe) => (
              <li
                key={probe.id}
                className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{probe.label}</p>
                  {probe.detail ? (
                    <p className="text-xs text-slate-500">{probe.detail}</p>
                  ) : null}
                  {probe.error ? (
                    <p className="text-xs text-brand-red">{probe.error}</p>
                  ) : null}
                </div>
                <span
                  className={cn(
                    "shrink-0 tabular-nums font-semibold",
                    probe.ok ? "text-slate-900" : "text-brand-red",
                    probe.ok && probe.ms > 2000 && "text-brand-orange",
                  )}
                >
                  {formatMs(probe.ms)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-sm text-slate-500">
          Нажми «Замерить latency», чтобы прогнать тяжёлые агрегаты без Next
          cache и увидеть, что дорого.
        </p>
      )}
    </div>
  );
}
