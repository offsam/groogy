"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Eye, GitMerge, Pause, X, XCircle } from "lucide-react";
import { AuthAlert } from "@/components/auth/AuthShell";
import { BusinessProfileView } from "@/components/business/profile/BusinessProfileView";
import { ProfessionalProfileView } from "@/components/professional/ProfessionalProfileView";
import { EventProfileView } from "@/components/events/EventProfileView";
import { JobProfileView } from "@/components/jobs/JobProfileView";
import { MarketplaceListingProfileView } from "@/components/marketplace/MarketplaceListingProfileView";
import { LechuProfileView } from "@/components/lechu/LechuProfileView";
import { TransferProfileView } from "@/components/transfers/TransferProfileView";
import { ServiceProfileView } from "@/components/services/ServiceProfileView";
import { Button } from "@/components/ui/Button";
import { AdminLensBar } from "@/components/admin/AdminLensBar";
import { AdminQueueCategoryButton } from "@/components/admin/AdminQueueCategoryButton";
import { useAdminPreviewMapCenter } from "@/components/admin/useAdminPreviewMapCenter";
import {
  approveImportReviewItemAction,
  mergeImportReviewIntoExistingAction,
  saveImportReviewItemAction,
  setImportReviewStatusAction,
  type DuplicateMatch,
  type ImportReviewActionResult,
} from "@/lib/import-review/actions";
import {
  importReviewItemToPreviewFields,
  importReviewToBusinessPreview,
  importReviewToEventPreview,
  importReviewToJobPreview,
  importReviewToOfferPreviews,
  importReviewToProfessionalPreview,
} from "@/lib/import-review/to-business-preview";
import { importReviewToListingPreview } from "@/lib/import-review/to-listing-preview";
import {
  businessPreviewCompleteness,
  listingPreviewCompleteness,
  professionalPreviewCompleteness,
} from "@/lib/import-review/preview-completeness";
import {
  IMPORT_PREVIEW_KIND_HINTS,
  IMPORT_PREVIEW_KIND_LABELS,
  resolveImportPreviewKind,
} from "@/lib/import-review/preview-section";
import type { ImportReviewItem } from "@/types/import-review";
import { IMPORT_REVIEW_STATUS_LABELS } from "@/types/import-review";
import type { ReviewCategoryOption } from "@/lib/import-review/category-options";
import { categoriesForPreviewHub } from "@/lib/import-review/category-options";
import { importTypesToHub } from "@/lib/import-review/hub-preview";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type Props = {
  item: ImportReviewItem;
  filterQuery?: string;
  onClose: () => void;
  onDone?: (flash?: "approved" | "rejected" | "deferred") => void;
  categories?: ReviewCategoryOption[];
};

export function ImportReviewPreviewModal({
  item,
  filterQuery = "",
  onClose,
  onDone,
  categories = [],
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
  const professional = useMemo(
    () => importReviewToProfessionalPreview(fields),
    [fields],
  );
  const offers = useMemo(() => importReviewToOfferPreviews(fields), [fields]);
  const completeness = useMemo(() => {
    if (kind === "professional") {
      return professionalPreviewCompleteness(professional);
    }
    if (kind === "business") {
      return businessPreviewCompleteness(business);
    }
    return listingPreviewCompleteness({
      title: fields.title || fields.business_name || fields.person_name,
      description: fields.description,
      city: fields.city,
      phone: fields.phone?.[0] ?? null,
      imageUrl: fields.preview_image_url,
      priceAmount: fields.price ?? null,
    });
  }, [kind, professional, business, fields]);
  const locked =
    item.review_status === "approved" ||
    item.review_status === "rejected" ||
    item.review_status === "duplicate";

  const cityMapCenter = useAdminPreviewMapCenter(
    business.city || professional.city || fields.city,
    business.stateCode || professional.stateCode || fields.state || null,
  );

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

  const hub = importTypesToHub(item.target_collection, item.entity_type);
  const categoryOptions = categoriesForPreviewHub(
    categories,
    hub ?? "businesses",
  );

  const draft = {
    onPublish: () =>
      run(() => approveImportReviewItemAction({ id: item.id }), "approved"),
    publishDisabled: locked,
    publishPending: pending,
    queue: {
      source: "import_review" as const,
      id: item.id,
    },
    onEnriched: () => router.refresh(),
    categorySlot:
      kind === "business" || kind === "professional" ? (
        <AdminQueueCategoryButton
          categories={categoryOptions}
          currentSlug={item.category}
          disabled={locked}
          onSave={async (slug) => {
            const res = await saveImportReviewItemAction({
              id: item.id,
              fields: { category: slug },
            });
            if (res.ok) router.refresh();
            return res;
          }}
        />
      ) : undefined,
  };

  const queueChrome =
    kind === "business" ? (
      <AdminLensBar
        business={business}
        draft={draft}
        kind="business"
        showDelete={false}
      />
    ) : kind === "professional" ? (
      <AdminLensBar
        draft={draft}
        kind="professional"
        professional={professional}
      />
    ) : kind === "events" ? (
      <AdminLensBar
        draft={draft}
        entityId={item.id}
        kind="event"
        title={fields.title || "Событие"}
      />
    ) : kind === "jobs" ? (
      <AdminLensBar
        draft={draft}
        entityId={item.id}
        kind="job"
        title={fields.title || "Вакансия"}
      />
    ) : kind === "lechu" ? (
      <AdminLensBar
        draft={draft}
        entityId={item.id}
        kind="lechu"
        title={fields.title || "Лечу"}
      />
    ) : kind === "transfers" ? (
      <AdminLensBar
        draft={draft}
        entityId={item.id}
        kind="transfer"
        title={fields.title || "Перевод"}
      />
    ) : kind === "services" ? (
      <AdminLensBar
        draft={draft}
        entityId={item.id}
        kind="service"
        title={fields.title || "Услуга"}
      />
    ) : (
      <AdminLensBar
        draft={draft}
        entityId={item.id}
        kind="marketplace"
        title={fields.title || "Объявление"}
      />
    );

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[1100] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-4"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="flex max-h-[96vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-slate-50 shadow-2xl max-sm:h-[100dvh] max-sm:max-h-none max-sm:rounded-none sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-5 sm:py-3">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400 sm:text-[11px]">
              <Eye className="size-3.5" />
              <span className="sm:hidden">Как на сайте</span>
              <span className="hidden sm:inline">
                {IMPORT_PREVIEW_KIND_LABELS[kind]} · как на платформе · не
                опубликовано
              </span>
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-600 sm:text-sm">
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

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 sm:px-5">
          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="min-w-0 overflow-x-hidden rounded-xl border border-slate-200 bg-white p-2.5 sm:rounded-2xl sm:p-4">
              {kind === "business" ? (
                <BusinessProfileView
                  adminChrome={queueChrome}
                  autoClaim={false}
                  business={business}
                  businessSlug={business.slug}
                  cityMapCenter={cityMapCenter}
                  currentUserId={null}
                  isAdmin={false}
                  isOwner={false}
                  jobs={[]}
                  myReview={null}
                  mySession={null}
                  offers={offers}
                  preview
                  reviews={[]}
                  similar={[]}
                />
              ) : kind === "professional" ? (
                <ProfessionalProfileView
                  adminChrome={queueChrome}
                  cityMapCenter={cityMapCenter}
                  currentUserId={null}
                  isOwner={false}
                  preview
                  professional={professional}
                  services={offers.map((o, index) => ({
                    id: o.id,
                    title: o.title,
                    description: o.description,
                    priceMode:
                      o.priceMode === "fixed" ||
                      o.priceMode === "from" ||
                      o.priceMode === "range" ||
                      o.priceMode === "free"
                        ? o.priceMode
                        : "contact",
                    priceAmount: o.priceAmount,
                    priceMin: o.priceMin,
                    priceMax: o.priceMax,
                    currency: o.currency,
                    priceUnit:
                      typeof o.priceUnit === "string" ? o.priceUnit : null,
                    durationMinutes: null,
                    sortOrder: index * 10,
                  }))}
                />
              ) : kind === "events" ? (
                <EventProfileView
                  adminChrome={queueChrome}
                  event={importReviewToEventPreview(fields)}
                  preview
                />
              ) : kind === "jobs" ? (
                <JobProfileView
                  adminChrome={queueChrome}
                  job={importReviewToJobPreview(fields)}
                  preview
                />
              ) : kind === "lechu" ? (
                <LechuProfileView
                  adminChrome={queueChrome}
                  listing={importReviewToListingPreview(fields, kind)}
                  preview
                />
              ) : kind === "transfers" ? (
                <TransferProfileView
                  adminChrome={queueChrome}
                  listing={importReviewToListingPreview(fields, kind)}
                  preview
                />
              ) : kind === "services" ? (
                <ServiceProfileView
                  adminChrome={queueChrome}
                  listing={importReviewToListingPreview(fields, kind)}
                  preview
                />
              ) : (
                <MarketplaceListingProfileView
                  adminChrome={queueChrome}
                  listing={importReviewToListingPreview(fields, kind)}
                  preview
                />
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  Чем наполнять
                </h3>
                <span className="text-xs text-slate-500">
                  {completeness.readyCount}/{completeness.total}
                </span>
              </div>
              <ul className="mt-3 space-y-1.5">
                {completeness.fields.map((field) => (
                  <li
                    key={field.key}
                    className="flex items-start justify-between gap-3 text-sm"
                  >
                    <span className="text-slate-700">
                      {field.label}
                      {!field.ok && field.hint ? (
                        <span className="mt-0.5 block text-xs text-slate-400">
                          {field.hint}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={
                        field.ok
                          ? "shrink-0 font-medium text-emerald-700"
                          : "shrink-0 font-medium text-amber-700"
                      }
                    >
                      {field.ok ? "есть" : "нужно"}
                    </span>
                  </li>
                ))}
              </ul>
              {completeness.missing.length > 0 ? (
                <p className="mt-3 text-xs leading-relaxed text-slate-500">
                  Доберите:{" "}
                  {completeness.missing
                    .map((f) => f.label.toLowerCase())
                    .join(", ")}
                  .
                </p>
              ) : (
                <p className="mt-3 text-xs leading-relaxed text-emerald-800">
                  Базовые поля на месте.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-3 border-t border-slate-200 bg-white px-3 py-2.5 pb-[max(0.65rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-3">
          {error ? <AuthAlert tone="error">{error}</AuthAlert> : null}
          {duplicates.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <p className="font-medium">Возможные дубликаты</p>
              <ul className="mt-2 space-y-2 text-xs">
                {duplicates.slice(0, 5).map((d) => (
                  <li
                    key={`${d.kind}-${d.id}`}
                    className="space-y-1.5 rounded-md border border-amber-200/70 bg-white/60 px-2 py-1.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {d.kind}: {d.title || d.id} — {d.reason}
                      </span>
                      <Button
                        className="gap-1 px-2.5 py-1 text-xs"
                        disabled={pending || locked}
                        onClick={() =>
                          run(
                            () =>
                              mergeImportReviewIntoExistingAction({
                                id: item.id,
                                matchKind: d.kind,
                                matchId: d.id,
                                matchTitle: d.title,
                                matchReason: d.reason,
                                matchSlug: d.slug,
                              }),
                            "approved",
                          )
                        }
                      >
                        <GitMerge className="h-3.5 w-3.5" />
                        Объединить
                      </Button>
                    </div>
                    {d.mergePreview ? (
                      <div className="text-[11px] text-amber-950/90">
                        <p className="font-medium">При объединении</p>
                        <p>{d.mergePreview.summary}</p>
                        {d.mergePreview.willAdd.length > 0 ? (
                          <p>
                            Добавит: {d.mergePreview.willAdd.join("; ")}
                          </p>
                        ) : (
                          <p>Новых полей не добавит</p>
                        )}
                        <p>{d.mergePreview.queueEffect}</p>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              <Button
                className="mt-2 min-h-11 w-full sm:min-h-0 sm:w-auto"
                variant="secondary"
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
                  <BrandPinLoader size="sm" className="mr-2" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                Одобрить как новую
              </Button>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Button
              className="min-h-11 sm:min-h-0"
              disabled={pending || locked}
              onClick={() =>
                run(
                  () => approveImportReviewItemAction({ id: item.id }),
                  "approved",
                )
              }
            >
              {pending ? (
                <BrandPinLoader size="sm" className="mr-2" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Одобрить
            </Button>
            <Button
              className="min-h-11 sm:min-h-0"
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
              className="min-h-11 border-red-200 text-red-700 hover:bg-red-50 sm:min-h-0"
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
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 sm:min-h-0 sm:w-auto"
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
