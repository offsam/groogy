"use client";

import { useCallback, useEffect, useState } from "react";
import { CatalogJobProgressBar } from "@/components/admin/CatalogJobProgressBar";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type StatusPayload = {
  ok: boolean;
  status: "running" | "finished" | "stalled" | "idle";
  message: string;
  done: number;
  total: number;
  remaining?: number;
  applied: number;
  skipped: number;
  failed: number;
  percent: number;
  lastName: string | null;
  elapsedS: number | null;
  recent: Array<{ id: string; name: string; href: string | null }>;
  errors: Array<{ id?: string; error?: string }>;
  logTail: string[];
  updatedAt: string | null;
  finishedAt: string | null;
};

type Props = {
  className?: string;
};

function formatElapsed(sec: number | null): string {
  if (sec == null || sec < 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h} ч ${m} мин`;
  return `${m} мин`;
}

export function To4kaEnrichLiveStatus({ className }: Props) {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/to4ka-enrich/status", {
        cache: "no-store",
      });
      const json = (await res.json()) as StatusPayload & { message?: string };
      if (!res.ok) {
        setError(json.message || `Ошибка ${res.status}`);
        return;
      }
      setError(null);
      setData(json);
      setLastFetchedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить статус");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      void load();
    }, 5000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const status = data?.status ?? "idle";
  const live = status === "running";
  // nowTick re-renders every second so "N сек назад" stays current between polls.
  void nowTick;
  const secondsSinceFetch =
    lastFetchedAt == null
      ? null
      : Math.max(0, Math.round((Date.now() - lastFetchedAt) / 1000));

  return (
    <div
      className={cn(
        "space-y-3 rounded-2xl border p-4 sm:p-5",
        live
          ? "border-brand-blue/30 bg-sky-50/80"
          : status === "finished"
            ? "border-emerald-200 bg-emerald-50/60"
            : status === "stalled"
              ? "border-amber-300 bg-amber-50/70"
              : "border-slate-200 bg-white",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            {live ? (
              <BrandPinLoader size="sm" />
            ) : null}
            Обогащение to4ka
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {loading && !data
              ? "Загрузка…"
              : data?.message || "Статус неизвестен"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="text-xs font-medium text-brand-blue hover:underline"
        >
          Обновить
        </button>
      </div>

      {status === "stalled" ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Похоже, скрипт завис или остановился. Перезапустите прогон вручную и
          нажмите «Обновить».
        </p>
      ) : null}

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {data && data.total > 0 ? (
        <>
          <CatalogJobProgressBar
            done={data.done}
            total={data.total}
            percent={data.percent}
            running={live}
            label={`осталось ${data.remaining ?? Math.max(0, data.total - data.done)} · ${formatElapsed(data.elapsedS)}`}
            meta={
              secondsSinceFetch != null
                ? `статус обновлён ${secondsSinceFetch} сек назад`
                : live
                  ? "опрос каждые 5 сек"
                  : null
            }
          />

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            <span>применено: {data.applied}</span>
            <span>пропуск: {data.skipped}</span>
            <span>ошибки: {data.failed}</span>
            {data.lastName ? (
              <span className="min-w-0 truncate text-slate-800">
                сейчас / последняя: {data.lastName}
              </span>
            ) : null}
          </div>

          {data.recent.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Недавно прошли
              </p>
              <ul className="divide-y divide-slate-200/80 overflow-hidden rounded-xl border border-slate-200 bg-white">
                {data.recent.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate text-slate-800">
                      {row.name}
                    </span>
                    {row.href ? (
                      <Link
                        href={row.href}
                        target="_blank"
                        className="shrink-0 text-xs font-medium text-brand-blue hover:underline"
                      >
                        Открыть
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.errors.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-red-700">Ошибки</p>
              <ul className="space-y-1 text-xs text-red-800">
                {data.errors.map((e, i) => (
                  <li key={`${e.id || "e"}-${i}`}>
                    {(e.id || "").slice(0, 8)}: {e.error || "—"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.logTail.length > 0 ? (
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer font-medium text-slate-600">
                Хвост лога
              </summary>
              <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-slate-900 p-2 text-[11px] leading-relaxed text-slate-100">
                {data.logTail.join("\n")}
              </pre>
            </details>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
