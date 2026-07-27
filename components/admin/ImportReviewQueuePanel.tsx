"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type {
  ImportReviewItem,
  ImportReviewStatus,
  ImportReviewTargetCollection,
} from "@/types/import-review";
import {
  IMPORT_REVIEW_STATUS_LABELS,
  IMPORT_TARGET_COLLECTION_LABELS,
} from "@/types/import-review";
import type {
  ImportReviewCounts,
  ImportReviewListItem,
} from "@/lib/import-review/queries";
import {
  CONTACT_LEVEL_LABELS,
  CONTACT_LEVEL_STYLES,
  getContactLevel,
  getDisplayContacts,
} from "@/lib/import-review/contacts";
import { ImportReviewContactIcons } from "@/components/admin/ImportReviewContactIcons";
import { ImportReviewPreviewModal } from "@/components/admin/ImportReviewPreviewModal";
import { ImportReviewTypedCard } from "@/components/admin/ImportReviewTypedCard";
import { EntitySourceCard } from "@/components/shared/EntitySourceCard";

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

const STATUS_KEYS: Array<ImportReviewStatus | "all"> = [
  "all",
  "pending",
  "ready_to_publish",
  "in_review",
  "approved",
  "rejected",
  "duplicate",
  "needs_more_info",
];

const COLLECTION_KEYS: Array<ImportReviewTargetCollection | "all"> = [
  "all",
  "businesses",
  "private_specialists",
  "services",
  "marketplace",
  "lechu",
  "transfers",
  "jobs",
  "events",
  "organizations",
  "real_estate",
];

type Props = {
  items: ImportReviewListItem[];
  total: number;
  counts: ImportReviewCounts;
  page: number;
  pageSize: number;
};

export function ImportReviewQueuePanel({
  items,
  total,
  counts,
  page,
  pageSize,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [previewId, setPreviewId] = useState<string | null>(null);

  const status = searchParams.get("status") ?? "pending";
  const collection = searchParams.get("collection") ?? "all";
  const sort = searchParams.get("sort") ?? "priority";
  const q = searchParams.get("q") ?? "";
  const previewItem = items.find((i) => i.id === previewId) ?? null;

  function setParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === "all") next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in patch)) next.delete("page");
    startTransition(() => {
      router.push(`/admin/import-review?${next.toString()}`);
    });
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const statusCounts = useMemo(() => {
    const by = counts.by_status ?? {};
    // «Все» = рабочая очередь, без duplicate / approved / rejected
    const open =
      (by.pending ?? 0) +
      (by.ready_to_publish ?? 0) +
      (by.in_review ?? 0) +
      (by.needs_more_info ?? 0);
    return {
      all: open,
      pending: by.pending ?? 0,
      ready_to_publish: by.ready_to_publish ?? 0,
      in_review: by.in_review ?? 0,
      approved: by.approved ?? 0,
      rejected: by.rejected ?? 0,
      duplicate: by.duplicate ?? 0,
      needs_more_info: by.needs_more_info ?? 0,
    };
  }, [counts]);

  return (
    <div className={`space-y-6 ${pending ? "opacity-70" : ""}`}>
      {previewItem ? (
        <ImportReviewPreviewModal
          filterQuery={searchParams.toString()}
          item={previewItem}
          onClose={() => setPreviewId(null)}
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        {STATUS_KEYS.map((key) => {
          const label =
            key === "all" ? "В очереди" : IMPORT_REVIEW_STATUS_LABELS[key];
          const count = statusCounts[key as keyof typeof statusCounts] ?? 0;
          const active = status === key || (key === "all" && status === "all");
          return (
            <button
              key={key}
              type="button"
              onClick={() => setParams({ status: key === "all" ? null : key })}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                active
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {label} ({count})
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {COLLECTION_KEYS.map((key) => {
          const label =
            key === "all" ? "Все коллекции" : IMPORT_TARGET_COLLECTION_LABELS[key];
          const count =
            key === "all"
              ? statusCounts.all
              : (counts.by_collection?.[key] ?? 0);
          const active = collection === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() =>
                setParams({ collection: key === "all" ? null : key })
              }
              className={`rounded-full px-3 py-1 text-xs ${
                active
                  ? "bg-brand-blue text-white"
                  : "border border-slate-200 bg-white text-slate-600"
              }`}
            >
              {label} ({count})
            </button>
          );
        })}
      </div>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setParams({
            q: String(fd.get("q") || "") || null,
            sort: String(fd.get("sort") || "priority"),
            has_phone: fd.get("has_phone") ? "1" : null,
            has_telegram: fd.get("has_telegram") ? "1" : null,
            has_instagram: fd.get("has_instagram") ? "1" : null,
            has_website: fd.get("has_website") ? "1" : null,
            has_media: fd.get("has_media") ? "1" : null,
          });
        }}
      >
        <input
          name="q"
          defaultValue={q}
          placeholder="Поиск: название, текст, телефон, Telegram…"
          className="min-w-[240px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <select
          name="sort"
          defaultValue={sort}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="priority">По приоритету</option>
          <option value="newest">Сначала новые</option>
          <option value="oldest">Сначала старые</option>
          <option value="confidence_desc">По AI confidence ↓</option>
          <option value="confidence_asc">По AI confidence ↑</option>
          <option value="posted_at">Дата Telegram</option>
          <option value="updated">Последние изменённые</option>
        </select>
        <label className="inline-flex items-center gap-1 text-xs text-slate-600">
          <input
            name="has_phone"
            type="checkbox"
            defaultChecked={searchParams.get("has_phone") === "1"}
          />
          phone
        </label>
        <label className="inline-flex items-center gap-1 text-xs text-slate-600">
          <input
            name="has_telegram"
            type="checkbox"
            defaultChecked={searchParams.get("has_telegram") === "1"}
          />
          telegram
        </label>
        <label className="inline-flex items-center gap-1 text-xs text-slate-600">
          <input
            name="has_instagram"
            type="checkbox"
            defaultChecked={searchParams.get("has_instagram") === "1"}
          />
          instagram
        </label>
        <label className="inline-flex items-center gap-1 text-xs text-slate-600">
          <input
            name="has_website"
            type="checkbox"
            defaultChecked={searchParams.get("has_website") === "1"}
          />
          website
        </label>
        <label className="inline-flex items-center gap-1 text-xs text-slate-600">
          <input
            name="has_media"
            type="checkbox"
            defaultChecked={searchParams.get("has_media") === "1"}
          />
          media
        </label>
        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          Применить
        </button>
      </form>

      <p className="text-sm text-slate-500">
        Показано {items.length} из {total} · страница {page}/{totalPages}.
        Сразу видна карточка как в выдаче. Кнопка «Показать полную карточку» —
        страница профиля целиком. Повторы одного бизнеса по телефону/Instagram
        автоматически схлопнуты в статус «Дубликаты».
      </p>

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          Нет записей по текущим фильтрам.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => {
            const days = daysSince(item.source_posted_at);
            const level = item.contact_level || getContactLevel(item);
            const junkTitle =
              !item.business_name &&
              (!item.title ||
                /^(messenger|gmail\.com|whatsapp|telegram)$/i.test(item.title.trim()));
            return (
              <li key={item.id} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
                <ImportReviewTypedCard item={item} />
                <div className="flex flex-wrap items-center gap-1.5">
                  {junkTitle ? (
                    <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                      Название из текста (сырое было мусорным)
                    </span>
                  ) : null}
                  {(item.photos_count ?? 0) > 0 ? (
                    <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
                      {item.preview_image_url
                        ? `TG фото: ${item.photos_count}`
                        : `TG фото: ${item.photos_count} (ещё не в превью)`}
                    </span>
                  ) : (
                    <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
                      Без TG фото
                    </span>
                  )}
                  <span
                    className={`rounded border px-2 py-0.5 text-[11px] font-medium ${CONTACT_LEVEL_STYLES[level]}`}
                  >
                    {CONTACT_LEVEL_LABELS[level]}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {formatDate(item.source_posted_at)}
                    {days != null ? ` · ${days} дн.` : ""}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ImportReviewContactIcons
                    contacts={getDisplayContacts(item)}
                    showLabels
                    max={6}
                  />
                </div>
                {item.source_url?.trim() ? (
                  <EntitySourceCard
                    anchorId={`queue-source-${item.id}`}
                    className="!rounded-xl !p-3"
                    hasSource
                    initiallyRevealed
                    isAuthenticated
                    sourceKind={
                      /facebook\.com|fb\.com/i.test(item.source_url)
                        ? "facebook"
                        : /t\.me\/|telegram\.me/i.test(item.source_url) ||
                            (item.source || "").startsWith("telegram")
                          ? "telegram"
                          : null
                    }
                    sourceUrl={item.source_url}
                  />
                ) : null}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                    type="button"
                    onClick={() => setPreviewId(item.id)}
                  >
                    Показать полную карточку
                  </button>
                  <Link
                    className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
                    href={`/admin/import-review/${item.id}?${searchParams.toString()}`}
                  >
                    Правки
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setParams({ page: String(page - 1) })}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:opacity-40"
        >
          Назад
        </button>
        <span className="text-sm text-slate-500">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => setParams({ page: String(page + 1) })}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:opacity-40"
        >
          Вперёд
        </button>
      </div>
    </div>
  );
}
