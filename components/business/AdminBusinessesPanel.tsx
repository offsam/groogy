"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  Clock3,
  Loader2,
  MapPin,
  Pause,
  Phone,
  X,
  XCircle,
} from "lucide-react";
import {
  adminSetBusinessStatusAction,
  mergeBusinessesAction,
} from "@/lib/business/admin-actions";
import { adminDeleteBusinessAction } from "@/lib/admin/actions";
import {
  adminBusinessToPreview,
  type AdminBusinessRow,
  type DuplicatePair,
} from "@/lib/business/admin-queries";
import {
  dayLabelRu,
  formatDayHoursLabel,
  isOpeningHours,
  openingHoursRows,
} from "@/lib/business/opening-hours";
import { structureBusinessProfileCopy } from "@/lib/content/structure-business-profile";
import { AuthAlert } from "@/components/auth/AuthShell";
import { BusinessCard } from "@/components/business/BusinessCard";
import { Button } from "@/components/ui/Button";
import { formatAddress } from "@/lib/supabase/mappers";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<AdminBusinessRow["status"], string> = {
  draft: "Черновик",
  pending: "На проверке",
  deferred: "Отложен",
  approved: "Опубликован",
  rejected: "Отклонён",
  archived: "Архив",
};

type ReviewQueue = "review" | "deferred" | "rejected" | "published";

type AdminBusinessesPanelProps = {
  pairs: DuplicatePair[];
  businesses: AdminBusinessRow[];
};

function DuplicateSummaryCard({
  row,
  badge,
  onOpen,
}: {
  row: AdminBusinessRow;
  badge?: string;
  onOpen: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
        {badge ? (
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {badge}
          </p>
        ) : (
          <span />
        )}
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
          {STATUS_LABELS[row.status]}
        </span>
      </div>
      <button
        className="w-full rounded-xl text-left transition hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
        onClick={onOpen}
        type="button"
      >
        <BusinessCard business={adminBusinessToPreview(row)} preview />
      </button>
      <p className="px-0.5 font-mono text-[11px] text-slate-400">{row.slug}</p>
    </div>
  );
}

function BusinessPreviewModal({
  row,
  pending,
  error,
  onClose,
  onApprove,
  onDefer,
  onReject,
}: {
  row: AdminBusinessRow;
  pending: boolean;
  error?: string | null;
  onClose: () => void;
  onApprove: () => void;
  onDefer: () => void;
  onReject: () => void;
}) {
  const business = adminBusinessToPreview(row);
  const address = formatAddress(business);
  const addressLine =
    address && business.region ? `${address}, ${business.region}` : address;
  const copy = structureBusinessProfileCopy(
    business.description,
    business.shortDescription,
  );
  const hours = isOpeningHours(row.opening_hours)
    ? openingHoursRows(row.opening_hours)
    : [];

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

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[1100] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-6"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-slate-50 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
              Превью публичной карточки
            </p>
            <p className="mt-0.5 truncate text-sm text-slate-600">
              {STATUS_LABELS[row.status]} · так увидят на сайте после одобрения
            </p>
          </div>
          <button
            aria-label="Закрыть"
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            onClick={onClose}
            type="button"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              В выдаче
            </p>
            <BusinessCard business={business} preview />
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-base font-semibold text-slate-900">
              {business.name}
            </h3>
            <p className="mt-0.5 text-sm text-slate-500">
              {[business.categoryName, business.city].filter(Boolean).join(" · ") ||
                "Без категории"}
            </p>

            {addressLine ? (
              <p className="mt-3 flex items-start gap-2 text-sm text-slate-600">
                <MapPin
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-slate-400"
                />
                <span>{addressLine}</span>
              </p>
            ) : (
              <p className="mt-3 text-sm text-slate-400">Адрес не указан</p>
            )}

            {business.phone ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                <Phone aria-hidden="true" className="size-4 shrink-0 text-slate-400" />
                {business.phone}
              </p>
            ) : null}

            {business.email ? (
              <p className="mt-1 text-sm text-slate-600">{business.email}</p>
            ) : null}

            {business.website ? (
              <p className="mt-1 truncate text-sm text-brand-blue">
                {business.website}
              </p>
            ) : null}

            {hours.length > 0 ? (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <Clock3 aria-hidden="true" className="size-4 text-slate-400" />
                  Часы работы
                </p>
                <ul className="mt-2 space-y-1 text-sm text-slate-600">
                  {hours.map((day) => (
                    <li
                      key={day.day}
                      className="flex items-center justify-between gap-3"
                    >
                      <span>{dayLabelRu(day.day)}</span>
                      <span className="tabular-nums text-slate-500">
                        {formatDayHoursLabel(day)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">О компании</h3>
            {copy.aboutPreview || copy.about ? (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {copy.aboutPreview || copy.about}
              </p>
            ) : (
              <p className="mt-2 text-sm text-slate-400">Описание пока пустое.</p>
            )}
            {copy.jobs ? (
              <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                  Вакансии
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-amber-950">
                  {copy.jobs}
                </p>
              </div>
            ) : null}
            {copy.promotions ? (
              <div className="mt-3 rounded-lg bg-brand-blue/5 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-blue">
                  Предложения
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                  {copy.promotions}
                </p>
              </div>
            ) : null}
            {row.offers_count > 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                Услуг / офферов: {row.offers_count}
              </p>
            ) : null}
          </section>
        </div>

        <div className="space-y-3 border-t border-slate-200 bg-white px-4 py-3 sm:px-5">
          {error ? <AuthAlert tone="error">{error}</AuthAlert> : null}
          <div className="grid gap-2 sm:grid-cols-3">
            <Button
              disabled={pending || row.status === "approved"}
              onClick={onApprove}
            >
              {pending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Одобрить
            </Button>
            <Button
              disabled={pending || row.status === "deferred"}
              variant="secondary"
              onClick={onDefer}
            >
              <Pause className="mr-2 h-4 w-4" />
              Отложить
            </Button>
            <Button
              className="border-red-200 text-red-700 hover:bg-red-50"
              disabled={pending || row.status === "rejected"}
              variant="secondary"
              onClick={onReject}
            >
              <XCircle className="mr-2 h-4 w-4" />
              Отклонить
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900"
              href={`/admin/businesses/${row.id}/edit`}
            >
              Редактировать
            </Link>
            <Button
              className="sm:ml-auto"
              disabled={pending}
              variant="secondary"
              onClick={onClose}
            >
              Закрыть
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdminBusinessesPanel({
  pairs,
  businesses,
}: AdminBusinessesPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [queue, setQueue] = useState<ReviewQueue>("review");

  const previewRow =
    businesses.find((b) => b.id === previewId) ??
    pairs.flatMap((p) => [p.a, p.b]).find((b) => b.id === previewId) ??
    null;

  function run(
    action: () => Promise<{ ok: boolean; message?: string }>,
    successFallback: string,
    closePreview = false,
  ) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message ?? "Ошибка");
        return;
      }
      setMessage(result.message ?? successFallback);
      if (closePreview) setPreviewId(null);
      router.refresh();
    });
  }

  const counts = useMemo(() => {
    const review = businesses.filter(
      (b) => b.status === "pending" || b.status === "draft",
    ).length;
    const deferred = businesses.filter((b) => b.status === "deferred").length;
    const rejected = businesses.filter((b) => b.status === "rejected").length;
    const published = businesses.filter((b) => b.status === "approved").length;
    return { review, deferred, rejected, published };
  }, [businesses]);

  const queueRows = useMemo(() => {
    switch (queue) {
      case "review":
        return businesses.filter(
          (b) => b.status === "pending" || b.status === "draft",
        );
      case "deferred":
        return businesses.filter((b) => b.status === "deferred");
      case "rejected":
        return businesses.filter((b) => b.status === "rejected");
      case "published":
        return businesses.filter((b) => b.status === "approved");
      default:
        return [];
    }
  }, [businesses, queue]);

  const tabs: { id: ReviewQueue; label: string; count: number }[] = [
    { id: "review", label: "На проверке", count: counts.review },
    { id: "deferred", label: "Отложены", count: counts.deferred },
    { id: "rejected", label: "Отклонённые", count: counts.rejected },
    { id: "published", label: "Опубликованные", count: counts.published },
  ];

  return (
    <div className="space-y-8">
      {error ? <AuthAlert tone="error">{error}</AuthAlert> : null}
      {message ? <AuthAlert tone="success">{message}</AuthAlert> : null}

      {previewRow ? (
        <BusinessPreviewModal
          error={error}
          pending={pending}
          row={previewRow}
          onApprove={() =>
            run(
              () =>
                adminSetBusinessStatusAction({
                  businessId: previewRow.id,
                  status: "approved",
                  slug: previewRow.slug,
                }),
              "Одобрено — карточка уже публичная",
              true,
            )
          }
          onClose={() => setPreviewId(null)}
          onDefer={() =>
            run(
              () =>
                adminSetBusinessStatusAction({
                  businessId: previewRow.id,
                  status: "deferred",
                  slug: previewRow.slug,
                }),
              "Отложено",
              true,
            )
          }
          onReject={() =>
            run(
              () =>
                adminSetBusinessStatusAction({
                  businessId: previewRow.id,
                  status: "rejected",
                  slug: previewRow.slug,
                }),
              "Отклонено",
              true,
            )
          }
        />
      ) : null}

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              Модерация бизнесов
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Нажмите на бизнес — откроется превью карточки. Одобрить =
              сразу на сайт, отложить = в очередь позже, отклонить = в
              отклонённые.
            </p>
          </div>
          <Link
            className="inline-flex rounded-lg border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            href="/admin/businesses/new"
          >
            + Добавить бизнес
          </Link>
        </div>

        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-medium transition",
                queue === tab.id
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200",
              )}
              type="button"
              onClick={() => setQueue(tab.id)}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>

        {queueRows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            В этой очереди пусто.
          </p>
        ) : queue === "review" || queue === "deferred" ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {queueRows.map((row) => (
              <li key={row.id}>
                <button
                  className="w-full rounded-xl text-left transition hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
                  type="button"
                  onClick={() => setPreviewId(row.id)}
                >
                  <BusinessCard
                    business={adminBusinessToPreview(row)}
                    preview
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {queueRows.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <button
                    className="text-left font-medium text-slate-900 hover:underline"
                    type="button"
                    onClick={() => setPreviewId(row.id)}
                  >
                    {row.name}
                  </button>
                  <p className="truncate text-xs text-slate-500">
                    {STATUS_LABELS[row.status]} · {row.city ?? "без города"} ·{" "}
                    {row.phone ?? "без телефона"} · офферов {row.offers_count}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={pending}
                    variant="secondary"
                    onClick={() => setPreviewId(row.id)}
                  >
                    Превью
                  </Button>
                  <Link
                    className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900"
                    href={`/admin/businesses/${row.id}/edit`}
                  >
                    Редактировать
                  </Link>
                  {queue === "published" ? (
                    <Button
                      disabled={pending}
                      variant="secondary"
                      onClick={() =>
                        run(
                          () =>
                            adminDeleteBusinessAction({
                              businessId: row.id,
                              slug: row.slug,
                            }),
                          "Удалено (архив)",
                        )
                      }
                    >
                      Удалить
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            Предложенные дубликаты
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Совпадение по телефону или нормализованному имени. Слева —
            рекомендуемый оригинал. Клик по имени — превью карточки.
          </p>
        </div>

        {pairs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            Дубликатов не найдено.
          </p>
        ) : (
          <ul className="space-y-4">
            {pairs.map((pair) => (
              <li
                key={pair.id}
                className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-4"
              >
                <p className="text-sm font-medium text-amber-900">
                  {pair.reasonLabel}
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  <DuplicateSummaryCard
                    badge="Оставить"
                    row={pair.a}
                    onOpen={() => setPreviewId(pair.a.id)}
                  />
                  <DuplicateSummaryCard
                    badge="Дубликат"
                    row={pair.b}
                    onOpen={() => setPreviewId(pair.b.id)}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          mergeBusinessesAction({
                            keepId: pair.a.id,
                            dropId: pair.b.id,
                            keepSlug: pair.a.slug,
                            dropSlug: pair.b.slug,
                          }),
                        "Смержено",
                      )
                    }
                  >
                    {pending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Смержить → оставить «{pair.a.name.slice(0, 28)}
                    {pair.a.name.length > 28 ? "…" : ""}»
                  </Button>
                  <Button
                    disabled={pending}
                    variant="secondary"
                    onClick={() =>
                      run(
                        () =>
                          mergeBusinessesAction({
                            keepId: pair.b.id,
                            dropId: pair.a.id,
                            keepSlug: pair.b.slug,
                            dropSlug: pair.a.slug,
                          }),
                        "Смержено",
                      )
                    }
                  >
                    Наоборот: оставить «{pair.b.name.slice(0, 24)}
                    {pair.b.name.length > 24 ? "…" : ""}»
                  </Button>
                  <Button
                    disabled={pending}
                    variant="secondary"
                    onClick={() =>
                      run(
                        () =>
                          adminSetBusinessStatusAction({
                            businessId: pair.b.id,
                            status: "archived",
                            slug: pair.b.slug,
                          }),
                        "Дубликат в архиве",
                      )
                    }
                  >
                    Только архивировать дубликат
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
