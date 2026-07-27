"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Eye, Loader2, Pause, X, XCircle } from "lucide-react";
import { AuthAlert } from "@/components/auth/AuthShell";
import { BusinessProfileView } from "@/components/business/profile/BusinessProfileView";
import { ImportReviewTypedCard } from "@/components/admin/ImportReviewTypedCard";
import { Button } from "@/components/ui/Button";
import {
  approveImportReviewItemAction,
  setImportReviewStatusAction,
  type DuplicateMatch,
  type ImportReviewActionResult,
} from "@/lib/import-review/actions";
import {
  importReviewItemToPreviewFields,
  importReviewToBusinessPreview,
  importReviewToOfferPreviews,
} from "@/lib/import-review/to-business-preview";
import {
  IMPORT_PREVIEW_KIND_HINTS,
  IMPORT_PREVIEW_KIND_LABELS,
  resolveImportPreviewKind,
} from "@/lib/import-review/preview-section";
import type { ImportReviewItem } from "@/types/import-review";
import { IMPORT_REVIEW_STATUS_LABELS } from "@/types/import-review";

type Props = {
  item: ImportReviewItem;
  filterQuery?: string;
  onClose: () => void;
  onDone?: (flash?: "approved" | "rejected" | "deferred") => void;
};

export function ImportReviewPreviewModal({
  item,
  filterQuery = "",
  onClose,
  onDone,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const fields = useMemo(() => importReviewItemToPreviewFields(item), [item]);
  const kind = useMemo(() => resolveImportPreviewKind(item), [item]);
  const business = useMemo(
    () => importReviewToBusinessPreview(fields),
    [fields],
  );
  const offers = useMemo(() => importReviewToOfferPreviews(fields), [fields]);
  const locked =
    item.review_status === "approved" ||
    item.review_status === "rejected" ||
    item.review_status === "duplicate";

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  useEffect(() => {
    setError(null);
    setDuplicates([]);
  }, [item.id]);

  function run(
    action: () => Promise<ImportReviewActionResult>,
    flash?: "approved" | "rejected" | "deferred",
  ) {
    setError(null);
    setDuplicates([]);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setError(result.message ?? "Не удалось выполнить действие");
          setDuplicates(result.duplicates ?? []);
          return;
        }
        onDone?.(flash);
        onClose();
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Не удалось выполнить действие",
        );
      }
    });
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[1100] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-4"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="flex max-h-[96vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-slate-50 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
              <Eye className="size-3.5" />
              {IMPORT_PREVIEW_KIND_LABELS[kind]} · превью раздела
            </p>
            <p className="mt-0.5 truncate text-sm text-slate-600">
              {IMPORT_REVIEW_STATUS_LABELS[item.review_status]} ·{" "}
              {IMPORT_PREVIEW_KIND_HINTS[kind]}
            </p>
          </div>
          <button
            aria-label="Закрыть"
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            type="button"
            onClick={onClose}
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-3 py-4 sm:px-5">
          <div className="pointer-events-none select-none rounded-2xl border border-slate-200 bg-[#f8fafc] p-3 sm:p-4">
            {kind === "business" ? (
              <BusinessProfileView
                autoClaim={false}
                business={business}
                businessSlug={business.slug}
                currentUserId={null}
                isAdmin={false}
                isOwner={false}
                jobs={[]}
                myReview={null}
                mySession={null}
                offers={offers}
                reviews={[]}
                similar={[]}
              />
            ) : (
              <div className="mx-auto max-w-md">
                <ImportReviewTypedCard item={item} />
                {fields.description ? (
                  <div className="mt-4 rounded-xl border border-slate-100 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Описание объявления
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                      {fields.description}
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3 border-t border-slate-200 bg-white px-4 py-3 sm:px-5">
          {error ? <AuthAlert tone="error">{error}</AuthAlert> : null}
          {duplicates.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <p className="font-medium">Возможные дубликаты</p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {duplicates.slice(0, 5).map((d) => (
                  <li key={`${d.kind}-${d.id}`}>
                    {d.kind}: {d.title || d.id} — {d.reason}
                  </li>
                ))}
              </ul>
              <Button
                className="mt-2"
                disabled={pending || locked}
                onClick={() =>
                  run(
                    () =>
                      approveImportReviewItemAction({
                        id: item.id,
                        force: true,
                      }),
                    "approved",
                  )
                }
              >
                {pending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                Одобрить несмотря на совпадения
              </Button>
            </div>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-3">
            <Button
              disabled={pending || locked}
              onClick={() =>
                run(
                  () => approveImportReviewItemAction({ id: item.id }),
                  "approved",
                )
              }
            >
              {pending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Одобрить
            </Button>
            <Button
              disabled={pending || locked || item.review_status === "in_review"}
              variant="secondary"
              onClick={() =>
                run(
                  () =>
                    setImportReviewStatusAction({
                      id: item.id,
                      status: "in_review",
                    }),
                  "deferred",
                )
              }
            >
              <Pause className="mr-2 h-4 w-4" />
              Отложить
            </Button>
            <Button
              className="border-red-200 text-red-700 hover:bg-red-50"
              disabled={pending || locked}
              variant="secondary"
              onClick={() =>
                run(
                  () =>
                    setImportReviewStatusAction({
                      id: item.id,
                      status: "rejected",
                      rejectReason: "insufficient_data",
                    }),
                  "rejected",
                )
              }
            >
              <XCircle className="mr-2 h-4 w-4" />
              Отклонить
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
              href={`/admin/import-review/${item.id}${filterQuery ? `?${filterQuery}` : ""}`}
              onClick={onClose}
            >
              Открыть правки
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
