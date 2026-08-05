"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles, X } from "lucide-react";
import { CatalogJobProgressBar } from "@/components/admin/CatalogJobProgressBar";
import type { PublishedEnrichKind } from "@/lib/admin/published-enrich-run";
import { cn } from "@/lib/utils";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type Props = {
  kind: PublishedEnrichKind;
  className?: string;
  onItemDone?: (id: string, ok: boolean) => void;
  onProgressId?: (id: string | null) => void;
  onIdle?: () => void;
};

type Target = { id: string; slug: string | null; name: string };

type LogLine = { id: string; name: string; ok: boolean; detail?: string };

const KIND_LABEL: Partial<Record<PublishedEnrichKind, string>> = {
  business: "бизнесы",
  professional: "специалисты",
  event: "события",
  job: "вакансии",
  marketplace: "маркетплейс",
  service: "услуги",
  transfer: "трансферы",
  lechu: "лечу",
  church: "церкви",
};

const SCRIPT_HINT: Partial<Record<PublishedEnrichKind, string>> = {
  business: "enrich_published_businesses.py",
  professional: "enrich_professionals_card_first.py",
  event: "enrich_published_events.py",
  church: "enrich_published_churches.py",
  job: "enrich_published_listings.py",
  service: "enrich_published_listings.py",
  marketplace: "enrich_published_listings.py",
  transfer: "enrich_published_listings.py",
  lechu: "enrich_published_listings.py",
};

async function fetchTargets(
  kind: PublishedEnrichKind,
  offset: number,
  limit: number,
): Promise<{
  total: number;
  items: Target[];
  nextOffset: number;
  hasMore: boolean;
  skippedAlready: number;
}> {
  const res = await fetch("/api/admin/catalog/enrich-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, offset, limit, mode: "list" }),
  });
  const data = (await res.json().catch(() => null)) as {
    message?: string;
    total?: number;
    items?: Target[];
    nextOffset?: number;
    hasMore?: boolean;
    skippedAlready?: number;
  } | null;
  if (!res.ok) {
    throw new Error(data?.message || `Список: ошибка ${res.status}`);
  }
  return {
    total: data?.total ?? 0,
    items: data?.items ?? [],
    nextOffset: data?.nextOffset ?? offset,
    hasMore: Boolean(data?.hasMore),
    skippedAlready: data?.skippedAlready ?? 0,
  };
}

async function markEnrichAllPass(
  kind: PublishedEnrichKind,
  id: string,
): Promise<void> {
  await fetch("/api/admin/catalog/enrich-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, id, mode: "mark" }),
  }).catch(() => {
    /* skip marker failure should not stop the batch */
  });
}

/** Same endpoint as the per-row «Обогатить» button. */
async function enrichOneCard(
  kind: PublishedEnrichKind,
  target: Target,
  signal: AbortSignal,
): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch("/api/admin/published/enrich", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind,
      id: target.id,
      ...(target.slug ? { slug: target.slug } : {}),
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as {
      message?: string;
    } | null;
    return {
      ok: false,
      message: data?.message || `Ошибка ${res.status}`,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let lastError: string | null = null;
  let finished = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let ev: { type?: string; message?: string };
      try {
        ev = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (ev.type === "error") {
        lastError = ev.message || "Ошибка обогащения";
      } else if (ev.type === "finished") {
        finished = true;
      }
    }
  }

  if (lastError) return { ok: false, message: lastError };
  if (!finished) {
    return { ok: false, message: "Стрим оборвался до finished" };
  }
  return { ok: true };
}

function fetchErrorMessage(err: unknown): string {
  if (err instanceof Error && err.name === "AbortError") {
    return "Остановлено";
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/failed to fetch/i.test(msg) || msg === "Failed to fetch") {
    return "Связь оборвалась (таймаут/сеть). Нажмите «Продолжить» — пойдёт со следующей карточки.";
  }
  return msg || "Не удалось обогатить";
}

export function CatalogEnrichAllButton({
  kind,
  className,
  onItemDone,
  onProgressId,
  onIdle,
}: Props) {
  const [running, setRunning] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [okCount, setOkCount] = useState(0);
  const [errCount, setErrCount] = useState(0);
  const [currentName, setCurrentName] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [resumeOffset, setResumeOffset] = useState(0);
  const [skippedAlready, setSkippedAlready] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const [nowTick, setNowTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const stopRef = useRef(false);

  async function runFrom(startOffset: number) {
    if (running) return;
    stopRef.current = false;
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    if (startOffset === 0) {
      startedAtRef.current = Date.now();
    } else if (!startedAtRef.current) {
      startedAtRef.current = Date.now();
    }
    setPanelOpen(true);
    setError(null);
    setMessage(null);
    if (startOffset === 0) {
      setOkCount(0);
      setErrCount(0);
      setLog([]);
      setDone(0);
      setSkippedAlready(0);
    }
    setCurrentName("Загрузка списка…");

    let offset = startOffset;
    let catalogTotal = total;
    let ok = startOffset === 0 ? 0 : okCount;
    let err = startOffset === 0 ? 0 : errCount;

    try {
      while (!stopRef.current) {
        const page = await fetchTargets(kind, offset, 20);
        catalogTotal = page.total;
        setTotal(catalogTotal);
        if (page.skippedAlready > 0) {
          setSkippedAlready(page.skippedAlready);
        }
        if (page.items.length === 0) break;

        for (let i = 0; i < page.items.length; i += 1) {
          if (stopRef.current || ac.signal.aborted) break;
          const target = page.items[i];
          const index = offset + i;
          setDone(index);
          setCurrentName(target.name);
          onProgressId?.(target.id);

          const res = await enrichOneCard(kind, target, ac.signal);
          if (res.ok) {
            ok += 1;
            setOkCount(ok);
            await markEnrichAllPass(kind, target.id);
            onItemDone?.(target.id, true);
            setLog((prev) =>
              [{ id: target.id, name: target.name, ok: true }, ...prev].slice(
                0,
                50,
              ),
            );
          } else {
            err += 1;
            setErrCount(err);
            onItemDone?.(target.id, false);
            setLog((prev) =>
              [
                {
                  id: target.id,
                  name: target.name,
                  ok: false,
                  detail: res.message,
                },
                ...prev,
              ].slice(0, 50),
            );
          }
          setDone(index + 1);
          setResumeOffset(index + 1);
        }

        offset = page.nextOffset;
        setResumeOffset(offset);
        if (!page.hasMore || stopRef.current || ac.signal.aborted) break;
      }

      if (stopRef.current || ac.signal.aborted) {
        setMessage(`Остановлено · ${ok} ок, ${err} ошибок · дальше с ${offset}`);
        setCurrentName("Остановлено");
      } else {
        setMessage(`Готово: ${ok} ок, ${err} ошибок из ${catalogTotal}`);
        setCurrentName("Готово");
        setDone(catalogTotal);
      }
    } catch (errObj) {
      setError(fetchErrorMessage(errObj));
      setMessage(`Пауза на позиции ${offset}. Можно «Продолжить».`);
      setResumeOffset(offset);
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setRunning(false);
      onIdle?.();
      onProgressId?.(null);
    }
  }

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  function stop() {
    stopRef.current = true;
    abortRef.current?.abort();
  }

  const remaining = Math.max(0, total - done);
  const percent =
    total > 0 ? Math.round((done / total) * 1000) / 10 : running ? 0 : 100;
  void nowTick;
  const elapsedSec = startedAtRef.current
    ? Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000))
    : 0;
  const avgSec = done > 0 ? elapsedSec / done : 0;
  const etaSec =
    running && remaining > 0 && avgSec > 0
      ? Math.round(avgSec * remaining)
      : null;
  const formatSec = (s: number) => {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m} мин ${r} сек` : `${r} сек`;
  };
  const progressMeta = running
    ? `прошло ${formatSec(elapsedSec)}${
        etaSec != null ? ` · ещё ~${formatSec(etaSec)}` : ""
      }`
    : null;
  const kindLabel = KIND_LABEL[kind] ?? kind;
  const scriptHint = SCRIPT_HINT[kind] ?? "enrich script";

  const panel =
    panelOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[1200] flex justify-end bg-slate-950/35"
            role="dialog"
            aria-modal="true"
            aria-label="Прогресс обогащения"
          >
            <button
              type="button"
              className="absolute inset-0 cursor-default"
              aria-label="Закрыть фон"
              onClick={() => {
                if (!running) setPanelOpen(false);
              }}
            />
            <aside className="relative flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    Обогащение каталога
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Раздел: {kindLabel}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                    {scriptHint} · только без истории обогащения
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Закрыть"
                  className="inline-flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50"
                  onClick={() => setPanelOpen(false)}
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-center">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-emerald-800/80">
                      Готово
                    </p>
                    <p className="mt-0.5 text-xl font-bold tabular-nums text-emerald-900">
                      {okCount}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-center">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                      Впереди
                    </p>
                    <p className="mt-0.5 text-xl font-bold tabular-nums text-slate-900">
                      {remaining}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-center">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                      Всего
                    </p>
                    <p className="mt-0.5 text-xl font-bold tabular-nums text-slate-900">
                      {total || "—"}
                    </p>
                  </div>
                </div>

                {skippedAlready > 0 ? (
                  <p className="text-xs text-slate-600">
                    Уже обогащённые пропущены: {skippedAlready}
                  </p>
                ) : null}

                {errCount > 0 ? (
                  <p className="text-xs text-red-700">
                    Ошибок в этой сессии: {errCount}
                  </p>
                ) : null}

                <CatalogJobProgressBar
                  done={done}
                  total={total || 1}
                  percent={percent}
                  running={running}
                  meta={progressMeta}
                />

                <div className="rounded-xl border border-brand-blue/25 bg-brand-blue/5 px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-blue-deep">
                    {running ? "Сейчас обогащается" : "Статус"}
                  </p>
                  <p className="mt-1 break-words text-sm font-semibold text-slate-900">
                    {currentName || "—"}
                  </p>
                  {running ? (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
                      <BrandPinLoader size="sm" />
                      Кнопка сработала · идёт обогащение · 30–90 сек / карта
                      {progressMeta ? ` · ${progressMeta}` : ""}
                    </p>
                  ) : null}
                </div>

                {message ? (
                  <p className="text-xs font-medium text-emerald-800">{message}</p>
                ) : null}
                {error ? (
                  <p className="text-xs text-red-700">{error}</p>
                ) : null}

                {log.length > 0 ? (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold text-slate-700">
                      Недавние
                    </p>
                    <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/80 p-2 text-xs">
                      {log.map((line, i) => (
                        <li
                          key={`${line.id}-${i}`}
                          className={
                            line.ok ? "text-emerald-800" : "text-red-700"
                          }
                        >
                          {line.ok ? "✓" : "✗"} {line.name}
                          {line.detail ? ` — ${line.detail}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
                {running ? (
                  <button
                    type="button"
                    onClick={stop}
                    className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
                  >
                    Стоп
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void runFrom(0)}
                      className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-brand-blue px-3 text-sm font-medium text-white hover:bg-brand-blue/90"
                    >
                      Сначала
                    </button>
                    {resumeOffset > 0 && resumeOffset < (total || Infinity) ? (
                      <button
                        type="button"
                        onClick={() => void runFrom(resumeOffset)}
                        className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-brand-blue px-3 text-sm font-medium text-brand-blue hover:bg-brand-blue/5"
                      >
                        Продолжить ({resumeOffset})
                      </button>
                    ) : null}
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setPanelOpen(false)}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Свернуть
                </button>
              </div>
            </aside>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div className={cn("flex flex-wrap items-center gap-2", className)}>
        <button
          type="button"
          disabled={running}
          onClick={() => void runFrom(0)}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-blue px-3 py-2 text-sm font-medium text-white hover:bg-brand-blue/90 disabled:opacity-60"
        >
          {running ? (
            <BrandPinLoader size="sm" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Обогатить все
        </button>
        {running || total > 0 || okCount > 0 ? (
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            {running ? "Окно прогресса" : "Показать прогресс"}
          </button>
        ) : null}
        {running ? (
          <button
            type="button"
            onClick={stop}
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Стоп
          </button>
        ) : null}
      </div>
      {panel}
    </>
  );
}
