"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  attachRecommendationFromLiveScanAction,
  dismissCatalogDuplicatePairAction,
  mergeCatalogDuplicateFromLiveScanAction,
  rejectRecommendationFromLiveScanAction,
  scanLiveEntityDuplicatesAction,
  type LiveDuplicateHit,
  type LiveEntityKind,
} from "@/lib/admin/published-duplicates-scan";
import { confirmRecommendationMergeAction } from "@/lib/import-review/recommendation-actions";
import { mergeImportReviewIntoExistingAction } from "@/lib/import-review/actions";
import { CatalogJobProgressBar } from "@/components/admin/CatalogJobProgressBar";
import { suggestEmployeeAttach } from "@/lib/admin/person-vs-firm";
import { cn } from "@/lib/utils";
import type { AdminEnrichQueueTarget } from "@/components/admin/AdminPublishedEnrichButton";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type Props = {
  kind: LiveEntityKind;
  entityId: string;
  slug?: string | null;
  className?: string;
  disabled?: boolean;
  /** Review/queue preview: same chip, scan from queue signals. */
  queue?: AdminEnrichQueueTarget;
};

export function AdminPublishedDuplicatesButton({
  kind,
  entityId,
  slug,
  className,
  disabled,
  queue,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selfName, setSelfName] = useState<string | null>(null);
  const [hits, setHits] = useState<LiveDuplicateHit[]>([]);
  const [scanNotes, setScanNotes] = useState<string[]>([]);
  const [scanProgress, setScanProgress] = useState<{
    done: number;
    total: number;
    percent: number;
  } | null>(null);
  const [scanning, setScanning] = useState(false);
  const canAttachRec =
    !queue && (kind === "business" || kind === "professional");
  const canMergeQueueIntoLive =
    Boolean(queue) && (kind === "business" || kind === "professional");

  async function runCatalogStreamScan() {
    setScanning(true);
    setScanProgress({ done: 0, total: 0, percent: 0 });
    try {
      const res = await fetch("/api/admin/catalog/duplicates/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id: entityId }),
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
            selfName?: string;
            hits?: LiveDuplicateHit[];
            done?: number;
            total?: number;
            percent?: number;
          };
          try {
            ev = JSON.parse(trimmed);
          } catch {
            continue;
          }
          if (ev.type === "started") {
            setSelfName(ev.selfName || null);
            setScanProgress({
              done: 0,
              total: ev.total ?? 0,
              percent: 0,
            });
          } else if (ev.type === "progress") {
            setScanProgress({
              done: ev.done ?? 0,
              total: ev.total ?? 0,
              percent: ev.percent ?? 0,
            });
          } else if (ev.type === "error") {
            setError(ev.message || "Ошибка скана");
          } else if (ev.type === "finished") {
            setSelfName(ev.selfName || null);
            setHits(ev.hits ?? []);
            setMessage(ev.message || null);
            setScanProgress({
              done: ev.total ?? ev.done ?? 0,
              total: ev.total ?? 0,
              percent: 100,
            });
          }
        }
      }
    } finally {
      setScanning(false);
    }
  }

  function runScan() {
    if (disabled) return;
    setOpen(true);
    setError(null);
    setMessage(null);
    setHits([]);
    setScanNotes([]);
    setSelfName(null);
    setScanProgress(null);
    startTransition(async () => {
      try {
        if (queue) {
          const res = await scanLiveEntityDuplicatesAction({
            entityType: kind,
            entityId: queue.id,
            queue,
          });
          if (!res.ok) {
            setError(res.message);
            return;
          }
          setSelfName(res.selfName);
          setHits(res.hits);
          setScanNotes(
            (res.scanNotes ?? []).filter(
              (n) =>
                !/does not exist/i.test(n) &&
                !/^column\b/i.test(n) &&
                !/\bauthor_id\b/i.test(n),
            ),
          );
          setMessage(res.message);
          return;
        }
        await runCatalogStreamScan();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Не удалось выполнить поиск",
        );
      }
    });
  }

  function removeHit(id: string, hitKind: LiveDuplicateHit["kind"]) {
    setHits((prev) =>
      prev.filter((h) => !(h.id === id && h.kind === hitKind)),
    );
  }

  function onMergeQueueIntoLive(hit: LiveDuplicateHit) {
    if (!queue || !canMergeQueueIntoLive) return;
    const hitKind =
      hit.entityType === "professional" || hit.entityType === "business"
        ? hit.entityType
        : kind === "professional" || kind === "business"
          ? kind
          : null;
    if (!hitKind) return;
    setActionId(hit.id);
    setError(null);
    startTransition(async () => {
      const res =
        queue.source === "recommendation"
          ? await confirmRecommendationMergeAction({
              id: queue.id,
              entityType: hitKind,
              entityId: hit.id,
            })
          : await mergeImportReviewIntoExistingAction({
              id: queue.id,
              matchKind: hitKind,
              matchId: hit.id,
              matchTitle: hit.name,
              matchSlug: hit.slug,
              matchReason: hit.reason,
            });
      setActionId(null);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setMessage(res.message || "Привязано к карточке на платформе");
      removeHit(hit.id, "catalog");
      router.refresh();
      if (hit.href) {
        window.location.href = hit.href;
      }
    });
  }

  function onAttach(hit: LiveDuplicateHit) {
    if (!canAttachRec) return;
    setActionId(hit.id);
    setError(null);
    startTransition(async () => {
      const res = await attachRecommendationFromLiveScanAction({
        recommendationId: hit.id,
        entityType: kind as "business" | "professional",
        entityId,
      });
      setActionId(null);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setMessage(res.message || "Прикреплено");
      removeHit(hit.id, "recommendation");
      router.refresh();
    });
  }

  function onRejectRec(hit: LiveDuplicateHit) {
    setActionId(hit.id);
    setError(null);
    startTransition(async () => {
      const res = await rejectRecommendationFromLiveScanAction({
        recommendationId: hit.id,
      });
      setActionId(null);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setMessage(res.message || "Отклонено");
      removeHit(hit.id, "recommendation");
      router.refresh();
    });
  }

  function onMergeCatalog(
    hit: LiveDuplicateHit,
    mode: "merge" | "attach_employee" = "merge",
  ) {
    if (mode === "attach_employee") {
      const selfLabel = selfName || slug || "эта карточка";
      const attach = suggestEmployeeAttach(
        { id: entityId, name: selfLabel, kind },
        {
          id: hit.id,
          name: hit.name,
          kind: hit.entityType || kind,
        },
      );
      if (!attach) {
        setError("Не похоже на пару «фирма + сотрудник».");
        return;
      }
      setActionId(`${hit.id}-attach`);
      setError(null);
      startTransition(async () => {
        const res = await mergeCatalogDuplicateFromLiveScanAction({
          keepKind: "business",
          dropKind: attach.personKind,
          keepId: attach.firmId,
          dropId: attach.personId,
          keepSlug: attach.firmId === entityId ? slug : hit.slug,
          dropSlug: attach.personId === entityId ? slug : hit.slug,
          mode: "attach_employee",
        });
        setActionId(null);
        if (!res.ok) {
          setError(res.message);
          return;
        }
        setMessage(res.message || "Привязано как сотрудник");
        removeHit(hit.id, "catalog");
        router.refresh();
        if (attach.personId === entityId && hit.href) {
          window.location.href = hit.href;
        }
      });
      return;
    }

    if (!hit.suggestedKeepId || !hit.suggestedDropId) return;
    const hitKind =
      hit.entityType === "professional" || hit.entityType === "business"
        ? hit.entityType
        : kind === "professional" || kind === "business"
          ? kind
          : null;
    if (!hitKind || (kind !== "business" && kind !== "professional")) return;

    const keepIsSelf = hit.suggestedKeepId === entityId;
    const keepKind = keepIsSelf ? kind : hitKind;
    const dropKind = keepIsSelf ? hitKind : kind;
    if (
      (keepKind !== "business" && keepKind !== "professional") ||
      (dropKind !== "business" && dropKind !== "professional")
    ) {
      return;
    }

    setActionId(hit.id);
    setError(null);
    startTransition(async () => {
      const res = await mergeCatalogDuplicateFromLiveScanAction({
        keepKind,
        dropKind,
        keepId: hit.suggestedKeepId!,
        dropId: hit.suggestedDropId!,
        keepSlug: keepIsSelf ? slug : hit.slug,
        dropSlug: keepIsSelf ? hit.slug : slug,
        mode: "merge",
      });
      setActionId(null);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setMessage(res.message || "Объединено");
      removeHit(hit.id, "catalog");
      router.refresh();
      // Dropped the card we were on — go to the kept live profile.
      if (!keepIsSelf && hit.href) {
        window.location.href = hit.href;
      }
    });
  }

  function onMergeAllCatalog() {
    const mergeable = catalog.filter(
      (h) =>
        h.suggestedKeepId &&
        h.suggestedDropId &&
        (h.entityType === "business" ||
          h.entityType === "professional" ||
          kind === "business" ||
          kind === "professional"),
    );
    if (!mergeable.length) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      let done = 0;
      for (const hit of mergeable) {
        const hitKind =
          hit.entityType === "professional" || hit.entityType === "business"
            ? hit.entityType
            : kind === "professional" || kind === "business"
              ? kind
              : null;
        if (!hitKind || (kind !== "business" && kind !== "professional")) {
          continue;
        }
        const keepIsSelf = hit.suggestedKeepId === entityId;
        const keepKind = keepIsSelf ? kind : hitKind;
        const dropKind = keepIsSelf ? hitKind : kind;
        if (
          (keepKind !== "business" && keepKind !== "professional") ||
          (dropKind !== "business" && dropKind !== "professional")
        ) {
          continue;
        }
        setActionId(hit.id);
        const res = await mergeCatalogDuplicateFromLiveScanAction({
          keepKind,
          dropKind,
          keepId: hit.suggestedKeepId!,
          dropId: hit.suggestedDropId!,
          keepSlug: keepIsSelf ? slug : hit.slug,
          dropSlug: keepIsSelf ? hit.slug : slug,
        });
        if (!res.ok) {
          setActionId(null);
          setError(res.message);
          return;
        }
        removeHit(hit.id, "catalog");
        done += 1;
      }
      setActionId(null);
      setMessage(
        done
          ? `Объединено карточек: ${done}.`
          : "Нечего объединять.",
      );
      router.refresh();
    });
  }

  const catalog = hits.filter((h) => h.kind === "catalog");
  const recommendations = hits.filter((h) => h.kind === "recommendation");

  return (
    <>
      <button
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60",
          className,
        )}
        disabled={disabled || (pending && !open)}
        type="button"
        onClick={() => runScan()}
      >
        {pending && !hits.length && open ? (
          <BrandPinLoader size="sm" />
        ) : (
          <Copy aria-hidden className="size-3.5" />
        )}
        {pending && open && !hits.length ? "Ищу…" : "Поиск двойников"}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-2xl border border-slate-200 bg-white shadow-xl sm:rounded-2xl">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Поиск двойников
                </h2>
                {selfName ? (
                  <p className="mt-0.5 text-xs text-slate-500">{selfName}</p>
                ) : null}
              </div>
              <button
                aria-label="Закрыть"
                className="inline-flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50"
                type="button"
                disabled={pending || scanning}
                onClick={() => setOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
              {scanProgress && (scanning || pending) ? (
                <CatalogJobProgressBar
                  done={scanProgress.done}
                  total={scanProgress.total}
                  percent={scanProgress.percent}
                  running={scanning || pending}
                  label="Сканирую каталог…"
                />
              ) : null}

              {pending && !hits.length && !error && !scanProgress ? (
                <p className="inline-flex items-center gap-2 text-slate-600">
                  <BrandPinLoader size="sm" />
                  Сканирую каталог и рекомендации…
                </p>
              ) : null}

              {message ? (
                <p className="text-xs font-medium text-slate-700">{message}</p>
              ) : null}
              {scanNotes.length > 0 ? (
                <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-slate-500">
                  {scanNotes
                    .filter(
                      (n) =>
                        !/does not exist/i.test(n) &&
                        !/^column\b/i.test(n) &&
                        !/\bauthor_id\b/i.test(n),
                    )
                    .map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                </ul>
              ) : null}
              {error ? <p className="text-xs text-red-600">{error}</p> : null}

              {!pending && !scanning && hits.length === 0 && !error ? (
                <p className="text-slate-600">Совпадений не найдено.</p>
              ) : null}

              {catalog.length > 0 ? (
                <section className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      В каталоге
                    </h3>
                    {(kind === "business" || kind === "professional") &&
                    catalog.length > 1 ? (
                      <Button
                        type="button"
                        className="px-2.5 py-1 text-xs"
                        disabled={pending}
                        onClick={() => onMergeAllCatalog()}
                      >
                        {pending && actionId
                          ? "Объединяю…"
                          : "Объединить все"}
                      </Button>
                    ) : null}
                  </div>
                  <ul className="space-y-2">
                    {catalog.map((hit) => {
                      const typeLabel =
                        hit.entityType === "professional"
                          ? "специалист"
                          : hit.entityType === "business"
                            ? "бизнес"
                            : hit.entityType || "";
                      const canMerge =
                        (kind === "business" || kind === "professional") &&
                        (hit.entityType === "business" ||
                          hit.entityType === "professional" ||
                          !hit.entityType);
                      return (
                      <li
                        key={`c-${hit.id}`}
                        className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900">
                              {hit.name}
                              {typeLabel ? (
                                <span className="ml-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                                  {typeLabel}
                                </span>
                              ) : null}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {hit.strength === "exact" ? "точное" : "слабое"} ·{" "}
                              {hit.reason}
                              {typeof hit.fillScore === "number"
                                ? ` · полей: ${hit.fillScore}`
                                : null}
                            </p>
                            {hit.href ? (
                              <Link
                                className="mt-1 inline-block text-xs text-brand-blue hover:underline"
                                href={hit.href}
                                target="_blank"
                              >
                                Открыть
                              </Link>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {canMerge ? (
                              <>
                                {(() => {
                                  if (queue) return null;
                                  const selfLabel =
                                    selfName || slug || "эта карточка";
                                  const attach = suggestEmployeeAttach(
                                    {
                                      id: entityId,
                                      name: selfLabel,
                                      kind,
                                    },
                                    {
                                      id: hit.id,
                                      name: hit.name,
                                      kind: hit.entityType || kind,
                                    },
                                  );
                                  if (!attach) return null;
                                  return (
                                    <Button
                                      type="button"
                                      className="px-2.5 py-1 text-xs"
                                      disabled={pending}
                                      onClick={() =>
                                        onMergeCatalog(hit, "attach_employee")
                                      }
                                    >
                                      {actionId === `${hit.id}-attach` ? (<><BrandPinLoader size="sm" className="mr-1 inline" />Как сотрудника</>) : "Как сотрудника"}
                                    </Button>
                                  );
                                })()}
                                <Button
                                  type="button"
                                  className="px-2.5 py-1 text-xs"
                                  variant={
                                    queue
                                      ? undefined
                                      : suggestEmployeeAttach(
                                            {
                                              id: entityId,
                                              name:
                                                selfName ||
                                                slug ||
                                                "эта карточка",
                                              kind,
                                            },
                                            {
                                              id: hit.id,
                                              name: hit.name,
                                              kind: hit.entityType || kind,
                                            },
                                          )
                                        ? "secondary"
                                        : undefined
                                  }
                                  disabled={pending}
                                  onClick={() =>
                                    queue
                                      ? onMergeQueueIntoLive(hit)
                                      : onMergeCatalog(hit, "merge")
                                  }
                                >
                                  {actionId === hit.id ? (<><BrandPinLoader size="sm" className="mr-1 inline" />{queue ? "Привязать" : "Склеить"}</>) : queue ? "Привязать" : "Склеить"}
                                </Button>
                              </>
                            ) : null}
                            <Button
                              type="button"
                              className="px-2.5 py-1 text-xs"
                              variant="secondary"
                              disabled={pending}
                              onClick={() => {
                                if (queue) {
                                  removeHit(hit.id, "catalog");
                                  return;
                                }
                                setActionId(`${hit.id}-dismiss`);
                                setError(null);
                                startTransition(async () => {
                                  const res =
                                    await dismissCatalogDuplicatePairAction({
                                      aKind: kind,
                                      aId: entityId,
                                      bKind: hit.entityType || kind,
                                      bId: hit.id,
                                    });
                                  setActionId(null);
                                  if (!res.ok) {
                                    setError(res.message);
                                    return;
                                  }
                                  setMessage(
                                    res.message || "Больше не предлагаем",
                                  );
                                  removeHit(hit.id, "catalog");
                                });
                              }}
                            >
                              {actionId === `${hit.id}-dismiss` ? (<><BrandPinLoader size="sm" className="mr-1 inline" />Не двойник</>) : "Не двойник"}
                            </Button>
                          </div>
                        </div>
                      </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}

              {recommendations.length > 0 ? (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Рекомендации
                  </h3>
                  <ul className="space-y-2">
                    {recommendations.map((hit) => (
                      <li
                        key={`r-${hit.id}`}
                        className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900">
                              {hit.name}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {hit.strength === "exact" ? "точное" : "слабое"} ·{" "}
                              {hit.reason}
                              {hit.status ? ` · ${hit.status}` : null}
                            </p>
                            {hit.href ? (
                              <Link
                                className="mt-1 inline-block text-xs text-brand-blue hover:underline"
                                href={hit.href}
                                target="_blank"
                              >
                                Открыть
                              </Link>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {canAttachRec ? (
                              <Button
                                type="button"
                                className="px-2.5 py-1 text-xs"
                                disabled={pending}
                                onClick={() => onAttach(hit)}
                              >
                                {actionId === hit.id ? (
                                  <>
                                    <BrandPinLoader size="sm" className="mr-1 inline" />
                                    Прикрепить
                                  </>
                                ) : (
                                  "Прикрепить"
                                )}
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              className="px-2.5 py-1 text-xs"
                              variant="secondary"
                              disabled={pending}
                              onClick={() => onRejectRec(hit)}
                            >
                              Отклонить
                            </Button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>

            <div className="flex gap-2 border-t border-slate-100 px-4 py-3">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                disabled={pending}
                onClick={() => runScan()}
              >
                Ещё раз
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                Закрыть
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
