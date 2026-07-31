"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  attachRecommendationFromLiveScanAction,
  mergeCatalogDuplicateFromLiveScanAction,
  rejectRecommendationFromLiveScanAction,
  scanLiveEntityDuplicatesAction,
  type LiveDuplicateHit,
  type LiveEntityKind,
} from "@/lib/admin/published-duplicates-scan";
import { cn } from "@/lib/utils";

type Props = {
  kind: LiveEntityKind;
  entityId: string;
  slug?: string | null;
  className?: string;
};

export function AdminPublishedDuplicatesButton({
  kind,
  entityId,
  slug,
  className,
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
  const canAttachRec = kind === "business" || kind === "professional";

  function runScan() {
    setOpen(true);
    setError(null);
    setMessage(null);
    setHits([]);
    setScanNotes([]);
    setSelfName(null);
    startTransition(async () => {
      try {
        const res = await scanLiveEntityDuplicatesAction({
          entityType: kind,
          entityId,
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

  function onMergeCatalog(hit: LiveDuplicateHit) {
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
        disabled={pending && !open}
        type="button"
        onClick={() => runScan()}
      >
        {pending && !hits.length && open ? (
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
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
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
              {pending && !hits.length && !error ? (
                <p className="inline-flex items-center gap-2 text-slate-600">
                  <Loader2 className="size-4 animate-spin text-brand-blue" />
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

              {!pending && hits.length === 0 && !error ? (
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
                              <Button
                                type="button"
                                className="px-2.5 py-1 text-xs"
                                disabled={pending}
                                onClick={() => onMergeCatalog(hit)}
                              >
                                {actionId === hit.id ? "…" : "Объединить"}
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              className="px-2.5 py-1 text-xs"
                              variant="secondary"
                              disabled={pending}
                              onClick={() => removeHit(hit.id, "catalog")}
                            >
                              Не дубль
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
                                {actionId === hit.id ? "…" : "Прикрепить"}
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
