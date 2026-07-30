"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Copy, GitMerge, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  approveImportReviewItemAction,
  mergeImportReviewIntoExistingAction,
  mergeQueueDuplicatesAction,
  scanImportReviewDuplicatesAction,
  setImportReviewStatusAction,
  type DuplicateMatch,
} from "@/lib/import-review/actions";
import { cn } from "@/lib/utils";

type Props = {
  itemId: string;
  disabled?: boolean;
  className?: string;
};

/** Top-of-workspace control: scan + merge matches (next to Обогатить). */
export function ReviewImportDuplicatesPanel({
  itemId,
  disabled,
  className,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);

  function runScan() {
    if (disabled || pending) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await scanImportReviewDuplicatesAction({ id: itemId });
        if (!res.ok) {
          setError(res.message || "Совпадения найдены");
          setDuplicates(res.duplicates ?? []);
          return;
        }
        setDuplicates([]);
        setMessage(res.message || "Совпадений нет");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Не удалось выполнить поиск",
        );
      }
    });
  }

  function collapseCopies() {
    if (disabled || pending) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await mergeQueueDuplicatesAction({ id: itemId });
        if (!res.ok) {
          setError(res.message || "Не удалось свернуть копии");
          return;
        }
        setDuplicates([]);
        setMessage(res.message || "Копии свёрнуты");
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Не удалось свернуть копии",
        );
      }
    });
  }

  return (
    <div className={cn("relative z-10 flex min-w-0 flex-col gap-2", className)}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="secondary"
          disabled={disabled || pending}
          className="w-full shrink-0 gap-1.5 sm:w-auto"
          onClick={runScan}
        >
          <Copy className="size-4" />
          {pending ? "Ищу…" : "Поиск двойников"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled || pending}
          className="w-full shrink-0 gap-1.5 sm:w-auto"
          onClick={collapseCopies}
        >
          <GitMerge className="size-4" />
          Свернуть копии
        </Button>
      </div>

      {error && duplicates.length === 0 ? (
        <p className="basis-full rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="basis-full rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800">
          {message}
        </p>
      ) : null}

      {duplicates.length > 0 ? (
        <div className="basis-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p className="font-medium">Найденные совпадения</p>
          {error ? (
            <p className="mt-1 text-xs text-amber-900/80">{error}</p>
          ) : null}
          <p className="mt-1 text-xs text-amber-900/80">
            Объединить — влить в существующую. Отклонить — закрыть как дубль
            без слияния. Или одобрить как новую.
          </p>
          <ul className="mt-2 space-y-2 text-xs">
            {duplicates.map((d) => {
              const href =
                d.kind === "business"
                  ? d.slug
                    ? `/business/${d.slug}`
                    : `/admin/catalog/businesses?q=${d.id}`
                  : d.kind === "import_item"
                    ? `/admin/review/workspace/import_review/${d.id}`
                    : `/admin/catalog/marketplace?q=${d.id}`;
              const preview = d.mergePreview;
              return (
                <li
                  key={`${d.kind}-${d.id}`}
                  className="rounded-lg border border-amber-200/80 bg-white/70 px-2.5 py-2"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">
                        {d.title || d.id}
                        {d.businessStatus === "archived" ? (
                          <span className="ml-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
                            архив
                          </span>
                        ) : null}
                      </p>
                      <p className="text-amber-900/70">
                        {d.kind} · {d.reason}
                        {d.businessStatus === "archived"
                          ? " · при объединении вернём из архива"
                          : ""}
                      </p>
                      {preview ? (
                        <div className="mt-2 space-y-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-700">
                          <p className="font-medium text-slate-800">
                            При объединении
                          </p>
                          <p>{preview.summary}</p>
                          {preview.willAdd.length > 0 ? (
                            <p>
                              <span className="font-medium text-emerald-800">
                                Добавит:
                              </span>{" "}
                              {preview.willAdd.join("; ")}
                            </p>
                          ) : (
                            <p className="text-slate-500">
                              Новых полей не добавит
                            </p>
                          )}
                          {preview.willSkip.length > 0 ? (
                            <p className="text-slate-500">
                              Не тронет: {preview.willSkip.join("; ")}
                            </p>
                          ) : null}
                          <p>{preview.queueEffect}</p>
                        </div>
                      ) : null}
                      <Link
                        className="mt-1 inline-block font-medium text-brand-blue hover:underline"
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Открыть
                      </Link>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1.5">
                      <Button
                        type="button"
                        className="gap-1 px-2.5 py-1 text-xs"
                        disabled={pending}
                        onClick={() => {
                          setError(null);
                          setMessage(null);
                          startTransition(async () => {
                            try {
                              const res =
                                await mergeImportReviewIntoExistingAction({
                                  id: itemId,
                                  matchKind: d.kind,
                                  matchId: d.id,
                                  matchTitle: d.title,
                                  matchReason: d.reason,
                                  matchSlug: d.slug,
                                });
                              if (!res.ok) {
                                setError(res.message || "Merge failed");
                                return;
                              }
                              setDuplicates([]);
                              setMessage(res.message || "Объединено");
                              router.refresh();
                            } catch (err) {
                              setError(
                                err instanceof Error
                                  ? err.message
                                  : "Не удалось объединить",
                              );
                            }
                          });
                        }}
                      >
                        <GitMerge className="size-3.5" />
                        Объединить
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="gap-1 px-2.5 py-1 text-xs"
                        disabled={pending}
                        onClick={() => {
                          setError(null);
                          setMessage(null);
                          startTransition(async () => {
                            try {
                              const res =
                                d.kind === "import_item"
                                  ? await setImportReviewStatusAction({
                                      id: itemId,
                                      status: "duplicate",
                                      duplicateOfItemId: d.id,
                                      notes: `Отклонён как дубль: ${d.reason || ""}`,
                                    })
                                  : await setImportReviewStatusAction({
                                      id: itemId,
                                      status: "duplicate",
                                      duplicateOfEntityType: d.kind,
                                      duplicateOfEntityId: d.id,
                                      notes: `Отклонён как дубль ${d.kind}: ${d.reason || ""}`,
                                    });
                              if (!res.ok) {
                                setError(res.message || "Reject failed");
                                return;
                              }
                              setDuplicates([]);
                              setMessage(
                                res.message || "Отклонено как дубль",
                              );
                              router.refresh();
                            } catch (err) {
                              setError(
                                err instanceof Error
                                  ? err.message
                                  : "Не удалось отклонить",
                              );
                            }
                          });
                        }}
                      >
                        <X className="size-3.5" />
                        Отклонить
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              className="gap-1.5 text-xs"
              disabled={pending}
              onClick={() => {
                setError(null);
                setMessage(null);
                startTransition(async () => {
                  const res = await approveImportReviewItemAction({
                    id: itemId,
                    force: true,
                  });
                  if (!res.ok) {
                    setError(res.message || "Approve failed");
                    setDuplicates(res.duplicates ?? []);
                    return;
                  }
                  setDuplicates([]);
                  setMessage("Approved (force)");
                  router.refresh();
                });
              }}
            >
              <Check className="size-3.5" />
              Одобрить как новую
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="text-xs"
              disabled={pending}
              onClick={() => {
                setDuplicates([]);
                setError(null);
              }}
            >
              Скрыть список
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
