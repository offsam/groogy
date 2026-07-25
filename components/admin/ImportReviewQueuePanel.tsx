"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";
import type {
  ImportReviewItem,
  ImportReviewStatus,
  ImportReviewTargetCollection,
} from "@/types/import-review";
import {
  IMPORT_ENTITY_TYPE_LABELS,
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

function ContactLine({ item }: { item: ImportReviewItem }) {
  const contacts = getDisplayContacts(item);
  if (contacts.length === 0) {
    return <span>нет контактов</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {contacts.slice(0, 3).map((c) =>
        c.href ? (
          <a
            key={`${c.kind}-${c.label}`}
            href={c.href}
            target="_blank"
            rel="noreferrer"
            className="text-brand-blue-deep underline-offset-2 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {c.label}
          </a>
        ) : (
          <span key={`${c.kind}-${c.label}`}>{c.label}</span>
        ),
      )}
    </span>
  );
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

  const status = searchParams.get("status") ?? "pending";
  const collection = searchParams.get("collection") ?? "all";
  const sort = searchParams.get("sort") ?? "priority";
  const q = searchParams.get("q") ?? "";

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
    return {
      all: counts.total,
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
      <div className="flex flex-wrap gap-2">
        {STATUS_KEYS.map((key) => {
          const label =
            key === "all" ? "Все" : IMPORT_REVIEW_STATUS_LABELS[key];
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
              ? counts.total
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
          <input name="has_phone" type="checkbox" defaultChecked={searchParams.get("has_phone") === "1"} />
          phone
        </label>
        <label className="inline-flex items-center gap-1 text-xs text-slate-600">
          <input name="has_telegram" type="checkbox" defaultChecked={searchParams.get("has_telegram") === "1"} />
          telegram
        </label>
        <label className="inline-flex items-center gap-1 text-xs text-slate-600">
          <input name="has_instagram" type="checkbox" defaultChecked={searchParams.get("has_instagram") === "1"} />
          instagram
        </label>
        <label className="inline-flex items-center gap-1 text-xs text-slate-600">
          <input name="has_website" type="checkbox" defaultChecked={searchParams.get("has_website") === "1"} />
          website
        </label>
        <label className="inline-flex items-center gap-1 text-xs text-slate-600">
          <input name="has_media" type="checkbox" defaultChecked={searchParams.get("has_media") === "1"} />
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
        Показано {items.length} из {total} · страница {page}/{totalPages}
      </p>

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {items.length === 0 ? (
          <li className="px-4 py-10 text-center text-sm text-slate-500">
            Нет записей по текущим фильтрам.
          </li>
        ) : (
          items.map((item) => {
            const days = daysSince(item.source_posted_at);
            const name =
              item.title ||
              item.business_name ||
              item.person_name ||
              "Без названия";
            const level = item.contact_level || getContactLevel(item);
            const sourceOpen = item.source_url?.trim();
            return (
              <li key={item.id}>
                <div className="px-4 py-4 hover:bg-slate-50">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <Link
                        href={`/admin/import-review/${item.id}?${searchParams.toString()}`}
                        className="block space-y-1"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded border px-2 py-0.5 text-xs font-medium ${CONTACT_LEVEL_STYLES[level]}`}
                          >
                            {CONTACT_LEVEL_LABELS[level]}
                          </span>
                          <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">
                            {IMPORT_REVIEW_STATUS_LABELS[item.review_status]}
                          </span>
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                            {item.entity_type
                              ? IMPORT_ENTITY_TYPE_LABELS[item.entity_type]
                              : "—"}
                          </span>
                          <span className="rounded bg-brand-blue/10 px-2 py-0.5 text-xs text-brand-blue-deep">
                            {item.target_collection
                              ? IMPORT_TARGET_COLLECTION_LABELS[
                                  item.target_collection
                                ]
                              : "—"}
                          </span>
                          {item.category && (
                            <span className="text-xs text-slate-500">
                              {item.category}
                            </span>
                          )}
                          {item.duplicate_status &&
                            item.duplicate_status !== "unique" && (
                              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                                {item.duplicate_status}
                                {item.occurrence_count
                                  ? ` ×${item.occurrence_count}`
                                  : ""}
                              </span>
                            )}
                          {item.photos_count > 0 && (
                            <span className="text-xs text-slate-500">
                              медиа: {item.photos_count} (не скачаны)
                            </span>
                          )}
                        </div>
                        <h3 className="truncate text-base font-semibold text-slate-900">
                          {name}
                        </h3>
                        <p className="line-clamp-2 text-sm text-slate-600">
                          {item.description || item.source_text || "—"}
                        </p>
                      </Link>
                      <p className="text-xs text-slate-500">
                        {item.city || "город не указан"}
                        {item.price != null
                          ? ` · ${item.price} ${item.currency || "USD"}`
                          : ""}
                        {" · "}
                        <ContactLine item={item} />
                      </p>
                      {sourceOpen ? (
                        <a
                          href={sourceOpen}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex text-xs font-medium text-brand-blue-deep hover:underline"
                        >
                          Открыть оригинал
                        </a>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right text-xs text-slate-500">
                      <div>TG: {formatDate(item.source_posted_at)}</div>
                      <div>{days != null ? `Прошло: ${days} дн.` : "—"}</div>
                      <div className="mt-1">
                        conf{" "}
                        {item.ai_confidence != null
                          ? Number(item.ai_confidence).toFixed(2)
                          : "—"}
                      </div>
                      <div className="mt-1 max-w-[220px] text-amber-700">
                        {item.ai_reason || "needs_review"}
                      </div>
                      <div className="mt-1 text-slate-600">
                        {item.source_author_username
                          ? `@${item.source_author_username}`
                          : item.source_author_display_name ||
                            "автор без username"}
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            );
          })
        )}
      </ul>

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
