"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, ChevronDown, Copy, GitMerge, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  approveImportReviewItemAction,
  mergeImportReviewIntoExistingAction,
  mergeQueueDuplicatesAction,
  mergeQueueItemsAction,
  scanImportReviewDuplicatesAction,
  setImportReviewStatusAction,
  type DuplicateMatch,
  type MergeAllPreview,
  type MergePreview,
} from "@/lib/import-review/actions";
import { DuplicateMatchReasonBadge } from "@/components/admin/DuplicateMatchReasonBadge";
import { reviewWorkspacePath } from "@/lib/admin/review-workspace/task-id";
import type { CardMatchSignals } from "@/lib/import-review/duplicate-match-label";
import { cn } from "@/lib/utils";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type Props = {
  itemId: string;
  disabled?: boolean;
  className?: string;
  /** Contacts on the open card — used to confirm «есть на этой карточке». */
  cardSignals?: CardMatchSignals | null;
};

function MergePreviewBlock({ preview }: { preview: MergePreview }) {
  return (
    <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-700">
      <p>{preview.summary}</p>
      {preview.willAdd.length > 0 ? (
        <p>
          <span className="font-medium text-emerald-800">Добавит:</span>{" "}
          {preview.willAdd.join("; ")}
        </p>
      ) : (
        <p className="text-slate-500">Новых полей не добавит</p>
      )}
      {preview.willSkip.length > 0 ? (
        <p className="text-slate-500">Не тронет: {preview.willSkip.join("; ")}</p>
      ) : null}
      {preview.queueEffect ? <p>{preview.queueEffect}</p> : null}
    </div>
  );
}

function kindLabel(d: DuplicateMatch): string {
  if (d.kind === "recommendation") return "рекомендация";
  if (d.kind === "import_item") {
    return d.queueOpen ? "очередь" : "одобренный импорт";
  }
  if (d.kind === "business") return "бизнес";
  if (d.kind === "professional") return "специалист";
  return d.kind;
}

/** Top-of-workspace control: scan + merge matches (next to Обогатить). */
export function ReviewImportDuplicatesPanel({
  itemId,
  disabled,
  className,
  cardSignals,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [mergeAllPreview, setMergeAllPreview] = useState<MergeAllPreview | null>(
    null,
  );
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const busy = pending || Boolean(busyLabel);

  function runBusy(label: string, work: () => Promise<void>) {
    if (disabled || busy) return;
    setError(null);
    setMessage(null);
    setBusyLabel(label);
    startTransition(async () => {
      try {
        await work();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ошибка");
      } finally {
        setBusyLabel(null);
      }
    });
  }

  /** Refresh the list in place: a merge usually leaves other copies behind. */
  async function rescan(keepMessage: boolean) {
    const res = await scanImportReviewDuplicatesAction({ id: itemId });
    if (!res.ok) {
      setError(res.message || "Совпадения найдены");
      setDuplicates(res.duplicates ?? []);
      setMergeAllPreview(res.mergeAllPreview ?? null);
      setExpandedKey(null);
      return;
    }
    setDuplicates([]);
    setMergeAllPreview(null);
    setExpandedKey(null);
    if (!keepMessage) setMessage(res.message || "Совпадений нет");
  }

  /**
   * After a merge: drop handled rows immediately so the screen changes, then
   * rescan. If the survivor is another card, navigate there.
   */
  async function afterMerge(
    survivorId: string | undefined,
    removedIds: string[] = [],
    liveHref?: string | null,
  ) {
    // Linked to an approved public card — open it (R16: pending/archived → no href).
    if (liveHref) {
      setDuplicates([]);
      setMergeAllPreview(null);
      setBusyLabel("Открываю карточку…");
      router.push(liveHref);
      return;
    }
    if (survivorId && survivorId !== itemId) {
      setDuplicates([]);
      setMergeAllPreview(null);
      setBusyLabel("Открываю карточку…");
      router.push(reviewWorkspacePath("import_review", survivorId));
      return;
    }
    if (removedIds.length) {
      const drop = new Set(removedIds);
      setDuplicates((prev) => prev.filter((d) => !drop.has(d.id)));
      setMergeAllPreview(null);
      setExpandedKey(null);
    }
    router.refresh();
    await rescan(true);
  }

  function runScan() {
    runBusy("Ищу двойников…", async () => {
      await rescan(false);
    });
  }

  function collapseCopies() {
    runBusy("Сворачиваю копии…", async () => {
      const openIds = duplicates
        .filter((d) => d.kind === "import_item" && d.queueOpen)
        .map((d) => d.id);
      const res = await mergeQueueDuplicatesAction({ id: itemId });
      if (!res.ok) {
        setError(res.message || "Не удалось свернуть копии");
        return;
      }
      setMessage(res.message || "Копии свёрнуты");
      await afterMerge(
        res.id,
        openIds,
        "liveHref" in res ? res.liveHref : undefined,
      );
    });
  }

  const queueMatches = duplicates.filter(
    (d) => d.kind === "import_item" && d.queueOpen,
  );
  const recommendationMatches = duplicates.filter(
    (d) => d.kind === "recommendation",
  );
  const businessMatches = duplicates.filter((d) => d.kind === "business");
  const professionalMatches = duplicates.filter(
    (d) => d.kind === "professional",
  );
  const approvedImportMatches = duplicates.filter(
    (d) => d.kind === "import_item" && !d.queueOpen,
  );
  const canMergeAll =
    queueMatches.length > 0 ||
    recommendationMatches.length > 0 ||
    businessMatches.length > 0 ||
    professionalMatches.length > 0 ||
    approvedImportMatches.some(
      (d) =>
        (d.publishedEntityType === "business" ||
          d.publishedEntityType === "professional") &&
        d.publishedEntityId,
    );

  function mergeAllMatches() {
    runBusy("Объединяю все совпадения…", async () => {
      const removed = [
        ...queueMatches.map((d) => d.id),
        ...recommendationMatches.map((d) => d.id),
        ...businessMatches.map((d) => d.id),
        ...professionalMatches.map((d) => d.id),
        ...approvedImportMatches.map((d) => d.id),
      ];
      const res = await mergeQueueItemsAction({
        id: itemId,
        matchIds: queueMatches.map((d) => d.id),
        recommendationIds: recommendationMatches.map((d) => d.id),
        businessIds: businessMatches.map((d) => d.id),
        professionalIds: professionalMatches.map((d) => d.id),
        approvedImportIds: approvedImportMatches.map((d) => d.id),
      });
      if (!res.ok) {
        setError(res.message || "Не удалось объединить");
        return;
      }
      setMessage(res.message || "Объединено");
      await afterMerge(
        res.id,
        removed,
        "liveHref" in res ? res.liveHref : undefined,
      );
    });
  }

  return (
    <div className={cn("relative z-10 flex min-w-0 flex-col gap-2", className)}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="secondary"
          disabled={disabled || busy}
          className="w-full shrink-0 gap-1.5 sm:w-auto"
          onClick={runScan}
        >
          {busy && busyLabel?.startsWith("Ищу") ? (
            <BrandPinLoader size="sm" />
          ) : (
            <Copy className="size-4" />
          )}
          {busy && busyLabel?.startsWith("Ищу") ? "Ищу…" : "Поиск двойников"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled || busy}
          className="w-full shrink-0 gap-1.5 sm:w-auto"
          onClick={collapseCopies}
        >
          {busy && busyLabel?.includes("Сворачиваю") ? (
            <BrandPinLoader size="sm" />
          ) : (
            <GitMerge className="size-4" />
          )}
          {busy && busyLabel?.includes("Сворачиваю")
            ? "Сворачиваю…"
            : "Свернуть копии"}
        </Button>
      </div>

      {busyLabel ? (
        <div
          className="basis-full flex items-center gap-2 rounded-lg border border-brand-blue/30 bg-brand-blue/10 px-2.5 py-2 text-xs font-medium text-slate-800"
          role="status"
          aria-live="polite"
        >
          <BrandPinLoader size="sm" className="shrink-0" />
          <span>{busyLabel}</span>
        </div>
      ) : null}

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
        <div
          className={cn(
            "relative basis-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950",
            busy ? "pointer-events-none opacity-80" : "",
          )}
        >
          {busy ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-white/55 backdrop-blur-[1px]">
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 shadow-sm">
                <BrandPinLoader size="sm" />
                {busyLabel || "Работаю…"}
              </div>
            </div>
          ) : null}
          <p className="font-medium">Найденные совпадения</p>
          {error ? (
            <p className="mt-1 text-xs text-amber-900/80">{error}</p>
          ) : null}
          <p className="mt-1 text-xs text-amber-900/80">
            «Объединить все»: копии в очереди + бизнес из каталога (в т.ч.
            архив) + рекомендации к этой live-карточке. Листинги без бизнеса —
            по одному.
          </p>
          {canMergeAll ? (
            <div className="mt-2 space-y-2 rounded-lg border border-amber-300/80 bg-white/80 px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-700">
                <span>
                  копий в очереди:{" "}
                  <strong className="tabular-nums">
                    {mergeAllPreview?.queueCopies ?? queueMatches.length}
                  </strong>
                </span>
                <span>
                  рекомендаций:{" "}
                  <strong className="tabular-nums">
                    {mergeAllPreview?.recommendations ??
                      recommendationMatches.length}
                  </strong>
                </span>
                {(mergeAllPreview?.catalogHits ?? 0) > 0 ? (
                  <span className="text-slate-500">
                    в каталоге: {mergeAllPreview!.catalogHits}
                  </span>
                ) : null}
              </div>
              <Button
                type="button"
                className="gap-1.5 text-xs"
                disabled={busy}
                onClick={mergeAllMatches}
              >
                {busy && busyLabel?.includes("Объединяю все") ? (
                  <BrandPinLoader size="sm" />
                ) : (
                  <GitMerge className="size-3.5" />
                )}
                {busy && busyLabel?.includes("Объединяю все")
                  ? "Объединяю…"
                  : "Объединить все"}
              </Button>
              {mergeAllPreview ? (
                <MergePreviewBlock preview={mergeAllPreview} />
              ) : null}
            </div>
          ) : null}
          <ul className="mt-2 space-y-2 text-xs">
            {duplicates.map((d) => {
              const key = `${d.kind}-${d.id}`;
              const href =
                d.kind === "business"
                  ? d.slug
                    ? `/business/${d.slug}`
                    : `/admin/catalog/businesses?q=${d.id}`
                  : d.kind === "professional"
                    ? d.slug
                      ? `/professional/${d.slug}`
                      : `/admin/catalog/professionals?q=${d.id}`
                  : d.kind === "import_item"
                    ? `/admin/review/workspace/import_review/${d.id}`
                    : d.kind === "recommendation"
                      ? `/admin/review/${encodeURIComponent(`recommendation:${d.id}`)}`
                      : `/admin/catalog/marketplace?q=${d.id}`;
              const preview = d.mergePreview;
              const open = expandedKey === key;
              const isRec = d.kind === "recommendation";
              return (
                <li
                  key={key}
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
                        {isRec ? (
                          <span className="ml-1.5 rounded bg-brand-green/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                            рек.
                            {d.mentionCount ? ` ×${d.mentionCount}` : ""}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-[11px] text-amber-900/70">
                        {kindLabel(d)}
                        {d.businessStatus === "archived"
                          ? " · при объединении вернём из архива"
                          : ""}
                      </p>
                      <DuplicateMatchReasonBadge
                        reason={d.reason}
                        card={cardSignals}
                      />
                      {isRec &&
                      (d.thirdPartyMentions || d.selfAdMentions) ? (
                        <p className="mt-0.5 text-[11px] text-emerald-800">
                          {d.thirdPartyMentions
                            ? `чужие ×${d.thirdPartyMentions}`
                            : ""}
                          {d.thirdPartyMentions && d.selfAdMentions
                            ? " · "
                            : ""}
                          {d.selfAdMentions
                            ? `сами ×${d.selfAdMentions}`
                            : ""}
                        </p>
                      ) : null}
                      {isRec && d.snippet ? (
                        <p className="mt-1 line-clamp-3 text-[11px] text-slate-600">
                          {d.snippet}
                        </p>
                      ) : null}
                      {preview ? (
                        <button
                          type="button"
                          className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-brand-blue hover:underline"
                          aria-expanded={open}
                          onClick={() =>
                            setExpandedKey(open ? null : key)
                          }
                        >
                          <ChevronDown
                            className={cn(
                              "size-3.5 transition",
                              open ? "rotate-180" : "",
                            )}
                          />
                          {open ? "Скрыть детали" : "Что добавит"}
                        </button>
                      ) : null}
                      {preview && open ? (
                        <div className="mt-1.5">
                          <MergePreviewBlock preview={preview} />
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
                        disabled={busy}
                        onClick={() => {
                          runBusy(
                            isRec
                              ? "Привязываю рекомендацию…"
                              : `Объединяю с «${d.title || "совпадением"}»…`,
                            async () => {
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
                              setMessage(res.message || "Объединено");
                              await afterMerge(
                                res.id,
                                [d.id],
                                "liveHref" in res ? res.liveHref : undefined,
                              );
                            },
                          );
                        }}
                      >
                        {busy ? (
                          <BrandPinLoader size="sm" />
                        ) : (
                          <GitMerge className="size-3.5" />
                        )}
                        {isRec ? "Привязать" : "Объединить"}
                      </Button>
                      {!isRec ? (
                        <Button
                          type="button"
                          variant="secondary"
                          className="gap-1 px-2.5 py-1 text-xs"
                          disabled={busy}
                          onClick={() => {
                            runBusy("Отклоняю как дубль…", async () => {
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
                              setMergeAllPreview(null);
                              setBusyLabel("Возвращаю в inbox…");
                              router.push("/admin/review/inbox");
                              router.refresh();
                            });
                          }}
                        >
                          <X className="size-3.5" />
                          Отклонить
                        </Button>
                      ) : null}
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
              disabled={busy}
              onClick={() => {
                runBusy("Одобряю как новую…", async () => {
                  const res = await approveImportReviewItemAction({
                    id: itemId,
                    force: true,
                  });
                  if (!res.ok) {
                    setError(res.message || "Approve failed");
                    setDuplicates(res.duplicates ?? []);
                    setMergeAllPreview(res.mergeAllPreview ?? null);
                    return;
                  }
                  setDuplicates([]);
                  setMergeAllPreview(null);
                  setBusyLabel("Возвращаю в inbox…");
                  router.push("/admin/review/inbox");
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
              disabled={busy}
              onClick={() => {
                setDuplicates([]);
                setMergeAllPreview(null);
                setExpandedKey(null);
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
