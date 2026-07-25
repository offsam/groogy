"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
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
import { AuthAlert } from "@/components/auth/AuthShell";
import { BusinessCard } from "@/components/business/BusinessCard";
import { Button } from "@/components/ui/Button";
import { formatAddress } from "@/lib/supabase/mappers";

const STATUS_LABELS: Record<AdminBusinessRow["status"], string> = {
  draft: "Черновик",
  pending: "На проверке",
  approved: "Опубликован",
  rejected: "Отклонён",
  archived: "Архив",
};

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
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          {badge ? (
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {badge}
            </p>
          ) : null}
          <button
            className="text-left font-semibold text-slate-900 hover:underline"
            onClick={onOpen}
            type="button"
          >
            {row.name}
          </button>
          <p className="mt-0.5 font-mono text-xs text-slate-500">{row.slug}</p>
        </div>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
          {STATUS_LABELS[row.status]}
        </span>
      </div>
      <dl className="mt-2 grid gap-1 text-slate-600">
        <div>
          <dt className="inline text-slate-400">Телефон: </dt>
          <dd className="inline">{row.phone ?? "—"}</dd>
        </div>
        <div>
          <dt className="inline text-slate-400">Город: </dt>
          <dd className="inline">{row.city ?? "—"}</dd>
        </div>
        <div>
          <dt className="inline text-slate-400">Адрес: </dt>
          <dd className="inline">{row.address_line ?? "—"}</dd>
        </div>
        <div>
          <dt className="inline text-slate-400">Офферы: </dt>
          <dd className="inline">{row.offers_count}</dd>
        </div>
      </dl>
    </div>
  );
}

function BusinessPreviewModal({
  row,
  pending,
  onClose,
  onApprove,
  onReject,
  onPending,
}: {
  row: AdminBusinessRow;
  pending: boolean;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onPending: () => void;
}) {
  const business = adminBusinessToPreview(row);
  const address = formatAddress(business);

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
        className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-slate-50 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
              Превью карточки
            </p>
            <p className="mt-0.5 truncate text-sm text-slate-600">
              {STATUS_LABELS[row.status]} · так увидят на сайте
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
          <BusinessCard business={business} preview />

          {(business.shortDescription || business.description || address) && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-900">
                Что попадёт на страницу
              </h3>
              {address ? (
                <p className="mt-2 text-sm text-slate-600">{address}</p>
              ) : null}
              {business.phone ? (
                <p className="mt-1 text-sm text-slate-600">{business.phone}</p>
              ) : null}
              {business.website ? (
                <p className="mt-1 truncate text-sm text-brand-blue">
                  {business.website}
                </p>
              ) : null}
              {business.description || business.shortDescription ? (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                  {business.description || business.shortDescription}
                </p>
              ) : (
                <p className="mt-3 text-sm text-slate-400">Описание пока пустое.</p>
              )}
            </section>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:px-5">
          {row.status !== "approved" ? (
            <Button disabled={pending} onClick={onApprove}>
              {pending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Одобрить
            </Button>
          ) : null}
          {row.status !== "rejected" ? (
            <Button disabled={pending} onClick={onReject} variant="secondary">
              Отклонить
            </Button>
          ) : null}
          {row.status !== "pending" ? (
            <Button disabled={pending} onClick={onPending} variant="secondary">
              В pending
            </Button>
          ) : null}
          <Link
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900"
            href={`/admin/businesses/${row.id}/edit`}
          >
            Редактировать
          </Link>
          <Button
            className="sm:ml-auto"
            disabled={pending}
            onClick={onClose}
            variant="secondary"
          >
            Закрыть
          </Button>
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

  const active = businesses.filter((b) => b.status !== "archived");
  const awaiting = active.filter(
    (b) => b.status === "pending" || b.status === "draft",
  );

  return (
    <div className="space-y-8">
      {error ? <AuthAlert tone="error">{error}</AuthAlert> : null}
      {message ? <AuthAlert tone="success">{message}</AuthAlert> : null}

      {previewRow ? (
        <BusinessPreviewModal
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
              "Опубликовано",
              true,
            )
          }
          onClose={() => setPreviewId(null)}
          onPending={() =>
            run(
              () =>
                adminSetBusinessStatusAction({
                  businessId: previewRow.id,
                  status: "pending",
                  slug: previewRow.slug,
                }),
              "Снято с публикации",
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

      {awaiting.length > 0 ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              На проверке ({awaiting.length})
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Нажмите на бизнес — откроется превью карточки, как на сайте.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {awaiting.map((row) => (
              <li key={row.id}>
                <button
                  className="w-full rounded-xl text-left transition hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
                  onClick={() => setPreviewId(row.id)}
                  type="button"
                >
                  <BusinessCard
                    business={adminBusinessToPreview(row)}
                    preview
                  />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              Все бизнесы ({active.length})
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Клик по названию — превью. Одобрить, редактировать или удалить.
            </p>
          </div>
          <Link
            className="inline-flex rounded-lg border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            href="/admin/businesses/new"
          >
            + Добавить бизнес
          </Link>
        </div>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {active.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <button
                  className="text-left font-medium text-slate-900 hover:underline"
                  onClick={() => setPreviewId(row.id)}
                  type="button"
                >
                  {row.name}
                </button>
                <p className="truncate text-xs text-slate-500">
                  {STATUS_LABELS[row.status]} · {row.city ?? "без города"} ·{" "}
                  {row.phone ?? "без телефона"} · офферов {row.offers_count}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {row.status !== "approved" ? (
                  <Button
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          adminSetBusinessStatusAction({
                            businessId: row.id,
                            status: "approved",
                            slug: row.slug,
                          }),
                        "Опубликовано",
                      )
                    }
                  >
                    Одобрить
                  </Button>
                ) : null}
                {row.status !== "pending" ? (
                  <Button
                    disabled={pending}
                    variant="secondary"
                    onClick={() =>
                      run(
                        () =>
                          adminSetBusinessStatusAction({
                            businessId: row.id,
                            status: "pending",
                            slug: row.slug,
                          }),
                        "Снято с публикации",
                      )
                    }
                  >
                    В pending
                  </Button>
                ) : null}
                <Link
                  className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900"
                  href={`/admin/businesses/${row.id}/edit`}
                >
                  Редактировать
                </Link>
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
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
