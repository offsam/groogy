"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  bulkAutopublishTo4kaAction,
  listTo4kaPublishedForPipelineAction,
  listTo4kaSuspectedDuplicatesAction,
  mergeTo4kaDuplicateRicherAction,
  recallTo4kaDuplicatesAction,
  type To4kaEnrichTarget,
  type To4kaRecalledDuplicate,
} from "@/lib/admin/imports/to4ka-pipeline";
import type { EnrichStreamEvent } from "@/lib/import-review/enrich-progress";
import { cn } from "@/lib/utils";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type Props = {
  className?: string;
};

export function To4kaPipelinePanel({ className }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [stepBusy, setStepBusy] = useState<
    null | "autopost" | "enrich" | "recall" | "merge"
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedLines, setFailedLines] = useState<string[]>([]);
  const [enrichTargets, setEnrichTargets] = useState<To4kaEnrichTarget[]>([]);
  const [enrichIndex, setEnrichIndex] = useState(0);
  const [enrichLabel, setEnrichLabel] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<To4kaRecalledDuplicate[]>([]);
  const [mergeId, setMergeId] = useState<string | null>(null);

  const loadDuplicates = useCallback(async () => {
    const res = await listTo4kaSuspectedDuplicatesAction();
    if (res.ok) setDuplicates(res.items);
  }, []);

  const loadEnrichTargets = useCallback(async () => {
    const res = await listTo4kaPublishedForPipelineAction();
    if (res.ok) setEnrichTargets(res.items);
  }, []);

  useEffect(() => {
    void loadDuplicates();
    void loadEnrichTargets();
  }, [loadDuplicates, loadEnrichTargets]);

  function runAutopost() {
    setError(null);
    setMessage(null);
    setFailedLines([]);
    setStepBusy("autopost");
    startTransition(async () => {
      try {
        const res = await bulkAutopublishTo4kaAction();
        if (!res.ok) {
          setError(res.message);
          return;
        }
        setMessage(
          `${res.message}${
            res.remainingPending
              ? ` Ещё pending: ${res.remainingPending} (нажмите ещё раз).`
              : ""
          }`,
        );
        setFailedLines(
          res.failed.slice(0, 12).map((f) => `${f.name}: ${f.message}`),
        );
        setEnrichTargets(res.published);
        await loadDuplicates();
        router.refresh();
      } finally {
        setStepBusy(null);
      }
    });
  }

  async function enrichOne(target: To4kaEnrichTarget): Promise<string | null> {
    const res = await fetch("/api/admin/published/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: target.kind,
        id: target.entityId,
        ...(target.slug ? { slug: target.slug } : {}),
      }),
    });
    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => null)) as {
        message?: string;
      } | null;
      return data?.message || `HTTP ${res.status}`;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastError: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let event: EnrichStreamEvent;
        try {
          event = JSON.parse(trimmed) as EnrichStreamEvent;
        } catch {
          continue;
        }
        if (event.type === "started" && event.label) {
          setEnrichLabel(event.label);
        } else if (event.type === "error") {
          lastError = event.message;
        } else if (event.type === "finished") {
          if (event.result?.reason && !event.result.patch) {
            setEnrichLabel(event.result.reason);
          }
        }
      }
    }

    return lastError;
  }

  function runEnrich() {
    setError(null);
    setMessage(null);
    setFailedLines([]);
    setStepBusy("enrich");
    startTransition(async () => {
      try {
        let targets = enrichTargets;
        if (!targets.length) {
          const listed = await listTo4kaPublishedForPipelineAction();
          if (!listed.ok) {
            setError(listed.message);
            return;
          }
          targets = listed.items;
          setEnrichTargets(targets);
        }
        if (!targets.length) {
          setMessage("Нет опубликованных to4ka-карточек для обогащения.");
          return;
        }

        const fails: string[] = [];
        for (let i = 0; i < targets.length; i += 1) {
          setEnrichIndex(i + 1);
          setEnrichLabel(targets[i].name);
          const err = await enrichOne(targets[i]);
          if (err) fails.push(`${targets[i].name}: ${err}`);
        }
        setFailedLines(fails.slice(0, 12));
        setMessage(
          `Обогащение: ${targets.length - fails.length}/${targets.length} ок.`,
        );
        router.refresh();
      } finally {
        setStepBusy(null);
        setEnrichLabel(null);
        setEnrichIndex(0);
      }
    });
  }

  function runRecall() {
    setError(null);
    setMessage(null);
    setFailedLines([]);
    setStepBusy("recall");
    startTransition(async () => {
      try {
        const res = await recallTo4kaDuplicatesAction();
        if (!res.ok) {
          setError(res.message);
          return;
        }
        setMessage(res.message);
        setFailedLines(
          res.failed.slice(0, 12).map((f) => `${f.name}: ${f.message}`),
        );
        setDuplicates(res.recalled);
        await loadEnrichTargets();
        await loadDuplicates();
        router.refresh();
      } finally {
        setStepBusy(null);
      }
    });
  }

  function runMerge(item: To4kaRecalledDuplicate) {
    setError(null);
    setMessage(null);
    setMergeId(item.recommendationId);
    setStepBusy("merge");
    startTransition(async () => {
      try {
        const res = await mergeTo4kaDuplicateRicherAction({
          recommendationId: item.recommendationId,
          keep: item.suggestedKeep,
          archivedKind: item.archivedKind,
          archivedId: item.archivedId,
          archivedSlug: item.archivedSlug,
          matchKind: item.matchKind,
          matchId: item.matchId,
          matchSlug: item.matchSlug,
        });
        if (!res.ok) {
          setError(res.message);
          return;
        }
        setMessage(res.message);
        await loadDuplicates();
        router.refresh();
      } finally {
        setMergeId(null);
        setStepBusy(null);
      }
    });
  }

  const busy = pending || stepBusy !== null;

  return (
    <div
      className={cn(
        "space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5",
        className,
      )}
    >
      <div>
        <h2 className="text-base font-semibold text-slate-900">
          Пайплайн to4ka
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          1) Автопост → 2) Обогатить → 3) Дубли снять с витрины и вернуть сюда.
          Без дубля остаются в открытом доступе.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          disabled={busy}
          onClick={runAutopost}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue/90 disabled:opacity-60"
        >
          {stepBusy === "autopost" ? (
            <BrandPinLoader size="sm" />
          ) : null}
          1. Автопост
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={runEnrich}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {stepBusy === "enrich" ? (
            <BrandPinLoader size="sm" />
          ) : null}
          2. Обогатить
          {enrichTargets.length ? ` (${enrichTargets.length})` : ""}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={runRecall}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-60"
        >
          {stepBusy === "recall" ? (
            <BrandPinLoader size="sm" />
          ) : null}
          3. Вернуть дубли
        </button>
      </div>

      {stepBusy === "enrich" && enrichLabel ? (
        <p className="text-sm text-slate-600">
          Обогащение {enrichIndex}/{enrichTargets.length || "?"}: {enrichLabel}
        </p>
      ) : null}

      {message ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {failedLines.length ? (
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
          {failedLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">
            Дубли в админке to4ka
            {duplicates.length ? ` (${duplicates.length})` : ""}
          </h3>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              startTransition(async () => {
                await loadDuplicates();
              });
            }}
            className="text-xs font-medium text-brand-blue hover:underline disabled:opacity-50"
          >
            Обновить
          </button>
        </div>

        {duplicates.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">
            Пока нет возвращённых дублей. После шага 3 они появятся здесь.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
            {duplicates.map((item) => {
              const keepLabel =
                item.suggestedKeep === "match"
                  ? item.matchName
                  : item.name;
              return (
                <li
                  key={item.recommendationId}
                  className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="truncate font-medium text-slate-900">
                      {item.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {item.strength.toUpperCase()} · {item.reason}
                    </p>
                    <p className="text-xs text-slate-600">
                      Матч:{" "}
                      {item.matchHref ? (
                        <Link
                          href={item.matchHref}
                          className="text-brand-blue hover:underline"
                          target="_blank"
                        >
                          {item.matchName}
                        </Link>
                      ) : (
                        item.matchName
                      )}{" "}
                      (fill {item.matchFillScore}) ↔ to4ka fill{" "}
                      {item.archivedFillScore}. Оставить: {keepLabel}
                    </p>
                    <Link
                      href={item.reviewHref}
                      className="text-xs font-medium text-brand-blue hover:underline"
                    >
                      Open in Review Center →
                    </Link>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runMerge(item)}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-blue px-3 py-2 text-sm font-medium text-white hover:bg-brand-blue/90 disabled:opacity-60"
                  >
                    {mergeId === item.recommendationId ? (
                      <BrandPinLoader size="sm" />
                    ) : null}
                    Склеить в пользу богатого
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
