"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, Loader2, X, XCircle } from "lucide-react";
import Link from "next/link";
import { BusinessCard } from "@/components/business/BusinessCard";
import { BusinessProfileView } from "@/components/business/profile/BusinessProfileView";
import { ProfessionalCard } from "@/components/professional/ProfessionalCard";
import { ProfessionalProfileView } from "@/components/professional/ProfessionalProfileView";
import { ServiceCard } from "@/components/services/ServiceCard";
import { Button } from "@/components/ui/Button";
import { AuthAlert } from "@/components/auth/AuthShell";
import type { CompletenessReport } from "@/lib/import-review/preview-completeness";
import {
  businessPreviewCompleteness,
  listingPreviewCompleteness,
  professionalPreviewCompleteness,
} from "@/lib/import-review/preview-completeness";
import {
  approveCommentRecommendationAction,
  rejectCommentRecommendationAction,
} from "@/lib/import-review/recommendation-actions";
import { recommendationCategoryLabel } from "@/lib/import-review/recommendation-category";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";
import {
  yellowPagesEntityKind,
  yellowPagesToBusinessPreview,
  yellowPagesToProfessionalPreview,
  yellowPagesToServicePreview,
  type YellowPagesPreviewKind,
} from "@/lib/import-review/yellow-pages-preview";

type Props = {
  item: CommentRecommendation;
  onClose: () => void;
  onDone?: () => void;
};

function CompletenessPanel({ report }: { report: CompletenessReport }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Что уже есть</h3>
        <span className="text-xs text-slate-500">
          {report.readyCount}/{report.total}
        </span>
      </div>
      <ul className="mt-3 space-y-1.5">
        {report.fields.map((field) => (
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
      {report.missing.length > 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Перед публикацией доберите:{" "}
          {report.missing.map((f) => f.label.toLowerCase()).join(", ")}.
        </p>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-emerald-800">
          Базовые поля заполнены — можно публиковать.
        </p>
      )}
    </div>
  );
}

function kindLabel(kind: YellowPagesPreviewKind): string {
  if (kind === "professional") return "Профи";
  if (kind === "service") return "Услуга";
  return "Бизнес";
}

function kindDestination(kind: YellowPagesPreviewKind): string {
  if (kind === "professional") return "каталог специалистов";
  if (kind === "service") return "раздел услуг";
  return "каталог бизнесов";
}

export function RecommendationPreviewModal({ item, onClose, onDone }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [publicPath, setPublicPath] = useState<string | null>(null);

  const kind = yellowPagesEntityKind(item);
  const business =
    kind === "business" ? yellowPagesToBusinessPreview(item) : null;
  const professional =
    kind === "professional" ? yellowPagesToProfessionalPreview(item) : null;
  const service = kind === "service" ? yellowPagesToServicePreview(item) : null;
  const locked = item.status === "approved" || item.status === "rejected";

  const completeness =
    kind === "professional" && professional
      ? professionalPreviewCompleteness(professional)
      : kind === "service" && service
        ? listingPreviewCompleteness({
            title: service.title,
            description: service.description,
            city: service.city,
            phone: item.phones[0] ?? null,
            imageUrl: service.media?.[0]?.publicUrl ?? null,
            priceAmount: service.priceAmount,
          })
        : businessPreviewCompleteness(
            business ?? yellowPagesToBusinessPreview(item),
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

  function run(
    action: () => Promise<{
      ok: boolean;
      message?: string;
      publicPath?: string;
    }>,
  ) {
    setError(null);
    setPublicPath(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setError(result.message ?? "Не удалось выполнить действие");
          return;
        }
        if (result.publicPath) {
          setPublicPath(result.publicPath);
        }
        onDone?.();
        router.refresh();
        if (result.publicPath) {
          // Keep modal open briefly with link, then close
          onClose();
        } else {
          onClose();
        }
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
              {kindLabel(kind)} · как на сайте
            </p>
            <p className="mt-0.5 truncate text-sm text-slate-600">
              {item.display_name || "Без названия"} ·{" "}
              {recommendationCategoryLabel(item.category_guess)} · после
              одобрения → {kindDestination(kind)}
              {item.city ? ` · ${item.city}` : ""}
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
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="pointer-events-none select-none rounded-2xl border border-slate-200 bg-[#f8fafc] p-3 sm:p-4">
              {kind === "business" && business ? (
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
                  offers={[]}
                  reviews={[]}
                  similar={[]}
                />
              ) : kind === "professional" && professional ? (
                <ProfessionalProfileView
                  currentUserId={null}
                  isOwner={false}
                  professional={professional}
                  services={[]}
                />
              ) : service ? (
                <div className="mx-auto max-w-md space-y-3">
                  <ServiceCard listing={service} preview />
                  {service.description ? (
                    <div className="rounded-xl border border-slate-100 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Описание
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                        {service.description}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Карточка в выдаче
                </p>
                {kind === "professional" && professional ? (
                  <ProfessionalCard professional={professional} preview />
                ) : kind === "service" && service ? (
                  <ServiceCard listing={service} preview />
                ) : (
                  <BusinessCard
                    business={business ?? yellowPagesToBusinessPreview(item)}
                    preview
                  />
                )}
              </div>

              <CompletenessPanel report={completeness} />

              {(item.comment_texts[0] || item.request_snippets[0]) && (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Исходный текст
                  </p>
                  <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm text-slate-700">
                    {item.comment_texts[0] || item.request_snippets[0]}
                  </p>
                </div>
              )}

              {item.source_post_urls[0] ? (
                <a
                  href={item.source_post_urls[0]}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex text-sm font-medium text-brand-blue hover:underline"
                >
                  Исходный пост →
                </a>
              ) : null}
            </div>
          </div>
        </div>

        <div className="space-y-3 border-t border-slate-200 bg-white px-4 py-3 sm:px-5">
          {error ? <AuthAlert tone="error">{error}</AuthAlert> : null}
          {publicPath ? (
            <p className="text-sm text-emerald-800">
              Опубликовано.{" "}
              <Link
                href={publicPath}
                className="font-medium text-brand-blue hover:underline"
              >
                Открыть на сайте →
              </Link>
            </p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              disabled={pending || locked}
              onClick={() =>
                run(() => approveCommentRecommendationAction({ id: item.id }))
              }
            >
              {pending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Одобрить · сразу на сайт
            </Button>
            <Button
              className="border-red-200 text-red-700 hover:bg-red-50"
              disabled={pending || locked}
              variant="secondary"
              onClick={() =>
                run(() => rejectCommentRecommendationAction({ id: item.id }))
              }
            >
              <XCircle className="mr-2 h-4 w-4" />
              Отклонить
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            Одобрение публикует карточку как есть — вид не меняется, статус
            становится активным в {kindDestination(kind)}.
          </p>
        </div>
      </div>
    </div>
  );
}
