"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, X } from "lucide-react";
import { CatalogJobProgressBar } from "@/components/admin/CatalogJobProgressBar";
import {
  dismissCatalogDuplicatePairAction,
  mergeCatalogDuplicateFromLiveScanAction,
} from "@/lib/admin/published-duplicates-scan";
import { suggestEmployeeAttach } from "@/lib/admin/person-vs-firm";
import type { PublishedEnrichKind } from "@/lib/admin/published-enrich-run";
import { cn } from "@/lib/utils";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type Side = {
  id: string;
  kind: string;
  name: string;
  href: string | null;
  slug?: string | null;
};

type Pair = {
  a: Side;
  b: Side;
  strength: "exact" | "weak";
  reason: string;
  suggestedKeepId: string;
  suggestedDropId: string;
  matchCount?: number;
  matchParams?: string[];
  matchPercent?: number;
};

type Props = {
  kind: PublishedEnrichKind;
  className?: string;
};

function paramLabel(p: string): string {
  const map: Record<string, string> = {
    phone: "телефон",
    email: "email",
    website: "сайт",
    instagram: "instagram",
    telegram: "telegram",
    source: "источник",
    address: "адрес",
    name: "название",
    description: "описание",
  };
  return map[p] || p;
}

export function CatalogFindDuplicatesButton({ kind, className }: Props) {
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    percent: number;
    currentName?: string | null;
    phase?: string | null;
  } | null>(null);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mergeId, setMergeId] = useState<string | null>(null);

  function close() {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setOpen(false);
  }

  async function start() {
    if (running) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setOpen(true);
    setRunning(true);
    setError(null);
    setMessage(null);
    setPairs([]);
    setProgress(null);
    try {
      const res = await fetch("/api/admin/catalog/duplicates/find-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(data?.message || `Ошибка ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let ev: {
            type?: string;
            message?: string;
            done?: number;
            total?: number;
            percent?: number;
            currentName?: string;
            phase?: string;
            pairs?: Pair[];
          };
          try {
            ev = JSON.parse(trimmed);
          } catch {
            continue;
          }
          if (ev.type === "started") {
            setProgress({
              done: 0,
              total: ev.total ?? 0,
              percent: 0,
              phase: ev.phase ?? "load",
              currentName: "Старт…",
            });
          } else if (ev.type === "progress") {
            setProgress({
              done: ev.done ?? 0,
              total: ev.total ?? 0,
              percent: ev.percent ?? 0,
              currentName: ev.currentName,
              phase: ev.phase,
            });
          } else if (ev.type === "error") {
            setError(ev.message || "Ошибка");
          } else if (ev.type === "finished") {
            const next = [...(ev.pairs ?? [])].sort((a, b) => {
              const pa = a.matchPercent ?? 0;
              const pb = b.matchPercent ?? 0;
              if (pb !== pa) return pb - pa;
              return (b.matchCount ?? 0) - (a.matchCount ?? 0);
            });
            setPairs(next);
            setMessage(ev.message || null);
            setProgress((prev) =>
              prev
                ? {
                    ...prev,
                    done: prev.total,
                    percent: 100,
                    phase: "done",
                    currentName: null,
                  }
                : {
                    done: 100,
                    total: 100,
                    percent: 100,
                    phase: "done",
                    currentName: null,
                  },
            );
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setMessage("Остановлено");
      } else {
        setError(err instanceof Error ? err.message : "Не удалось сканировать");
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setRunning(false);
    }
  }

  async function mergePair(
    pair: Pair,
    mode: "merge" | "attach_employee" = "merge",
  ) {
    setError(null);
    if (mode === "attach_employee") {
      const attach = suggestEmployeeAttach(pair.a, pair.b);
      if (!attach) {
        setError("Не похоже на пару «фирма + сотрудник».");
        return;
      }
      setMergeId(`${pair.a.id}-${pair.b.id}-attach`);
      const res = await mergeCatalogDuplicateFromLiveScanAction({
        keepKind: "business",
        dropKind: attach.personKind,
        keepId: attach.firmId,
        dropId: attach.personId,
        keepSlug:
          attach.firmId === pair.a.id ? pair.a.slug : pair.b.slug,
        dropSlug:
          attach.personId === pair.a.id ? pair.a.slug : pair.b.slug,
        mode: "attach_employee",
      });
      setMergeId(null);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setPairs((prev) =>
        prev.filter(
          (p) =>
            !(
              (p.a.id === pair.a.id && p.b.id === pair.b.id) ||
              (p.a.id === pair.b.id && p.b.id === pair.a.id)
            ),
        ),
      );
      setMessage(res.message || "Привязано как сотрудник");
      router.refresh();
      return;
    }

    const keep = pair.suggestedKeepId === pair.a.id ? pair.a : pair.b;
    const drop = pair.suggestedDropId === pair.a.id ? pair.a : pair.b;
    if (
      (keep.kind !== "business" && keep.kind !== "professional") ||
      (drop.kind !== "business" && drop.kind !== "professional")
    ) {
      setError("Merge пока только для business / professional.");
      return;
    }
    setMergeId(`${pair.a.id}-${pair.b.id}`);
    const res = await mergeCatalogDuplicateFromLiveScanAction({
      keepKind: keep.kind,
      dropKind: drop.kind,
      keepId: keep.id,
      dropId: drop.id,
      keepSlug: keep.slug,
      dropSlug: drop.slug,
      mode: "merge",
    });
    setMergeId(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setPairs((prev) =>
      prev.filter(
        (p) =>
          !(
            (p.a.id === pair.a.id && p.b.id === pair.b.id) ||
            (p.a.id === pair.b.id && p.b.id === pair.a.id)
          ),
      ),
    );
    setMessage(res.message || "Объединено");
    router.refresh();
  }

  async function dismissPair(pair: Pair) {
    const key = `${pair.a.id}-${pair.b.id}`;
    setMergeId(`${key}-dismiss`);
    setError(null);
    const res = await dismissCatalogDuplicatePairAction({
      aKind: pair.a.kind,
      aId: pair.a.id,
      bKind: pair.b.kind,
      bId: pair.b.id,
    });
    setMergeId(null);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setPairs((prev) =>
      prev.filter(
        (p) =>
          !(
            (p.a.id === pair.a.id && p.b.id === pair.b.id) ||
            (p.a.id === pair.b.id && p.b.id === pair.a.id)
          ),
      ),
    );
    setMessage(res.message || "Больше не предлагаем");
  }

  return (
    <>
      <button
        type="button"
        disabled={running}
        onClick={() => void start()}
        className={cn(
          "inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-60",
          className,
        )}
      >
        {running ? (
          <BrandPinLoader size="sm" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
        Поиск двойников
      </button>

      {open ? (
        <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-2xl border border-slate-200 bg-white shadow-xl sm:rounded-2xl">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Двойники в разделе
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">{kind}</p>
              </div>
              <div className="flex items-center gap-1">
                {running ? (
                  <button
                    type="button"
                    className="inline-flex min-h-8 items-center rounded-lg border border-slate-200 px-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    onClick={() => {
                      abortRef.current?.abort();
                    }}
                  >
                    Стоп
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label="Закрыть"
                  className="inline-flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50"
                  onClick={close}
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm">
              {progress ? (
                <CatalogJobProgressBar
                  done={progress.done}
                  total={progress.total}
                  percent={progress.percent}
                  running={running}
                  label={
                    progress.phase === "load"
                      ? progress.currentName || "Загрузка…"
                      : progress.currentName
                  }
                />
              ) : running ? (
                <p className="text-xs text-slate-500">Подключение…</p>
              ) : null}
              {message ? (
                <p className="text-xs font-medium text-slate-700">{message}</p>
              ) : null}
              {error ? <p className="text-xs text-red-600">{error}</p> : null}

              {!running && pairs.length === 0 && !error && !message ? (
                <p className="text-slate-600">Пар не найдено.</p>
              ) : null}

              {pairs.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-500">
                    Сверху — больше общих полей (email, адрес, описание…). Ниже —
                    слабее совпадение.
                  </p>
                  <ul className="space-y-2">
                    {pairs.map((pair) => {
                      const key = `${pair.a.id}-${pair.b.id}`;
                      const keepName =
                        pair.suggestedKeepId === pair.a.id
                          ? pair.a.name
                          : pair.b.name;
                      const count = pair.matchCount ?? 1;
                      const pct = pair.matchPercent ?? 0;
                      const params = pair.matchParams ?? [];
                      return (
                        <li
                          key={key}
                          className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-slate-800">
                              {count}{" "}
                              {count === 1
                                ? "поле"
                                : count < 5
                                  ? "поля"
                                  : "полей"}{" "}
                              · {pct}%
                            </p>
                            <span className="rounded-md bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600">
                              {pair.strength}
                            </span>
                          </div>
                          {params.length > 0 ? (
                            <p className="mt-1 text-[11px] text-slate-500">
                              Совпали:{" "}
                              {params.map(paramLabel).join(", ")}
                            </p>
                          ) : (
                            <p className="mt-1 text-[11px] text-slate-500">
                              {pair.reason}
                            </p>
                          )}
                          <p className="mt-1.5 text-sm text-slate-900">
                            {pair.a.href ? (
                              <Link
                                href={pair.a.href}
                                className="text-brand-blue hover:underline"
                                target="_blank"
                              >
                                {pair.a.name}
                              </Link>
                            ) : (
                              pair.a.name
                            )}{" "}
                            ↔{" "}
                            {pair.b.href ? (
                              <Link
                                href={pair.b.href}
                                className="text-brand-blue hover:underline"
                                target="_blank"
                              >
                                {pair.b.name}
                              </Link>
                            ) : (
                              pair.b.name
                            )}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-600">
                            Оставить: {keepName}
                          </p>
                          {(() => {
                            const attach = suggestEmployeeAttach(
                              pair.a,
                              pair.b,
                            );
                            const busy =
                              running ||
                              mergeId === key ||
                              mergeId === `${key}-attach` ||
                              mergeId === `${key}-dismiss`;
                            const canMergeTypes =
                              (pair.a.kind === "business" ||
                                pair.a.kind === "professional") &&
                              (pair.b.kind === "business" ||
                                pair.b.kind === "professional");
                            return (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {canMergeTypes && attach ? (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      void mergePair(pair, "attach_employee")
                                    }
                                    className="inline-flex min-h-10 items-center rounded-lg bg-brand-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-blue/90 disabled:opacity-60"
                                    title={`Фирма: ${attach.firmName} · сотрудник: ${attach.personName}`}
                                  >
                                    {mergeId === `${key}-attach` ? (
                                      <BrandPinLoader size="sm" className="mr-1" />
                                    ) : null}
                                    Привязать как сотрудника
                                  </button>
                                ) : null}
                                {canMergeTypes ? (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void mergePair(pair, "merge")}
                                    className={cn(
                                      "inline-flex min-h-10 items-center rounded-lg px-2.5 py-1.5 text-xs font-medium disabled:opacity-60",
                                      attach
                                        ? "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                                        : "bg-brand-blue text-white hover:bg-brand-blue/90",
                                    )}
                                  >
                                    {mergeId === key ? (
                                      <BrandPinLoader size="sm" className="mr-1" />
                                    ) : null}
                                    Склеить
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void dismissPair(pair)}
                                  className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                                >
                                  {mergeId === `${key}-dismiss` ? (
                                    <BrandPinLoader size="sm" className="mr-1" />
                                  ) : null}
                                  Не двойник
                                </button>
                              </div>
                            );
                          })()}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
