"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { AdminPublishedDuplicatesButton } from "@/components/admin/AdminPublishedDuplicatesButton";
import { AdminEntitySourcesButton } from "@/components/admin/AdminEntitySourcesButton";
import { AdminPublishedEnrichButton } from "@/components/admin/AdminPublishedEnrichButton";
import { AdminPasteEnrichButton } from "@/components/admin/AdminPasteEnrichButton";
import { CatalogEnrichAllButton } from "@/components/admin/CatalogEnrichAllButton";
import { CatalogFindDuplicatesButton } from "@/components/admin/CatalogFindDuplicatesButton";
import { signalAppNavigation } from "@/components/layout/NavigationProgress";
import type { PublishedEnrichKind } from "@/lib/admin/published-enrich-run";
import {
  CATALOG_SORT_OPTIONS,
  CATALOG_STATUS_OPTIONS,
  type CatalogFilterOption,
  type CatalogSort,
  type CatalogStatusFilter,
} from "@/lib/admin/catalog/types";

export type CatalogBrowserItem = {
  id: string;
  statusLabel: string;
  publicHref: string | null;
  editHref: string | null;
  archiveAvailable: boolean;
  onArchive?: () => Promise<{ ok: boolean; message?: string }>;
  /** Show enrich + duplicate-scan controls for published catalog entities. */
  enrichKind?:
    | "business"
    | "professional"
    | "event"
    | "job"
    | "service"
    | "transfer"
    | "marketplace"
    | "lechu"
    | "church";
  slug?: string | null;
  /** Dense list row fields */
  title?: string;
  locationLine?: string | null;
  categoryLabel?: string | null;
  createdAt?: string | null;
};

type Props = {
  title: string;
  description: string;
  basePath: string;
  total: number;
  page: number;
  pageSize: number;
  q: string;
  status: CatalogStatusFilter;
  sort: CatalogSort;
  legacyHref?: string;
  legacyLabel?: string;
  /** Card grid (default) or dense find-and-edit list */
  layout?: "cards" | "list";
  state?: string;
  county?: string;
  category?: string;
  stateOptions?: CatalogFilterOption[];
  countyOptions?: CatalogFilterOption[];
  categoryOptions?: CatalogFilterOption[];
  /** Rendered card preview for each item (cards layout) */
  items: Array<{
    meta: CatalogBrowserItem;
    card?: ReactNode;
  }>;
  error?: string | null;
  /** Section-level enrich-all (businesses / professionals / …). */
  sectionEnrichKind?: PublishedEnrichKind;
};

type HrefNext = {
  q?: string;
  status?: string;
  sort?: string;
  page?: number;
  state?: string;
  county?: string;
  category?: string;
};

function hrefFor(basePath: string, next: HrefNext) {
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.status && next.status !== "published") {
    params.set("status", next.status);
  }
  if (next.sort && next.sort !== "newest") params.set("sort", next.sort);
  if (next.state) params.set("state", next.state);
  if (next.county) params.set("county", next.county);
  if (next.category) params.set("category", next.category);
  if (next.page && next.page > 1) params.set("page", String(next.page));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function ItemActions({
  meta,
  pending,
  onArchive,
}: {
  meta: CatalogBrowserItem;
  pending: boolean;
  onArchive: () => void;
}) {
  return (
    <>
      {meta.publicHref ? (
        <Link
          href={meta.publicHref}
          className="inline-flex min-h-11 items-center rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
          target="_blank"
          rel="noreferrer"
        >
          Сайт
        </Link>
      ) : null}
      {meta.editHref ? (
        <Link
          href={meta.editHref}
          className="inline-flex min-h-11 items-center rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
        >
          Edit
        </Link>
      ) : (
        <span
          className="inline-flex min-h-11 items-center rounded-lg border border-dashed border-slate-200 px-2.5 py-1.5 text-xs text-slate-400"
          title="Coming Soon"
        >
          Edit · Soon
        </span>
      )}
      {meta.enrichKind ? (
        <>
          <AdminPublishedEnrichButton
            entityId={meta.id}
            kind={meta.enrichKind}
            slug={meta.slug ?? undefined}
          />
          {(meta.enrichKind === "business" ||
            meta.enrichKind === "professional" ||
            meta.enrichKind === "church") &&
          meta.slug ? (
            <AdminPasteEnrichButton
              entityId={meta.id}
              kind={meta.enrichKind}
              slug={meta.slug}
            />
          ) : null}
          {meta.enrichKind !== "church" ? (
            <AdminPublishedDuplicatesButton
              entityId={meta.id}
              kind={meta.enrichKind}
              slug={meta.slug}
            />
          ) : null}
          {(meta.enrichKind === "business" ||
            meta.enrichKind === "professional") && (
            <AdminEntitySourcesButton
              entityId={meta.id}
              kind={meta.enrichKind}
            />
          )}
        </>
      ) : null}
      {meta.archiveAvailable && meta.onArchive ? (
        <button
          type="button"
          disabled={pending}
          className="inline-flex min-h-11 items-center rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          onClick={onArchive}
        >
          Archive
        </button>
      ) : null}
    </>
  );
}

export function CatalogBrowser({
  title,
  description,
  basePath,
  total,
  page,
  pageSize,
  q,
  status,
  sort,
  legacyHref,
  legacyLabel,
  layout = "list",
  state = "",
  county = "",
  category = "",
  stateOptions,
  countyOptions,
  categoryOptions,
  items,
  error,
  sectionEnrichKind,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showGeo =
    stateOptions !== undefined ||
    countyOptions !== undefined ||
    categoryOptions !== undefined;
  const enrichKind =
    sectionEnrichKind ||
    items.find((it) => it.meta.enrichKind)?.meta.enrichKind ||
    null;
  const [sessionEnrich, setSessionEnrich] = useState<
    Record<string, "ok" | "err">
  >({});
  const [enrichCurrentId, setEnrichCurrentId] = useState<string | null>(null);

  const baseNext = {
    q,
    status,
    sort,
    state: state || undefined,
    county: county || undefined,
    category: category || undefined,
  };

  function onSearchSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const nextQ = String(fd.get("q") ?? "").trim();
    const nextState = String(fd.get("state") ?? "").trim();
    const nextCounty = String(fd.get("county") ?? "").trim();
    const nextCategory = String(fd.get("category") ?? "").trim();
    // Changing state clears county (options belong to the previous state).
    const countyKeep =
      nextState && nextState === state ? nextCounty : "";
    signalAppNavigation();
    router.push(
      hrefFor(basePath, {
        q: nextQ,
        status,
        sort,
        state: nextState || undefined,
        county: countyKeep || undefined,
        category: nextCategory || undefined,
        page: 1,
      }),
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 sm:space-y-6">
      <div>
        <p className="text-sm font-medium text-brand-blue-deep">Каталог</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {title}
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
          {description}
        </p>
        {legacyHref ? (
          <p className="mt-3 flex flex-wrap gap-4 text-sm">
            <Link href={legacyHref} className="text-brand-blue hover:underline">
              {legacyLabel ?? "Legacy tool"}
            </Link>
            {enrichKind === "business" ? (
              <Link
                href="/admin/to4ka-enrich"
                className="font-medium text-brand-blue hover:underline"
              >
                Прогресс обогащения to4ka →
              </Link>
            ) : null}
          </p>
        ) : enrichKind === "business" ? (
          <p className="mt-3 text-sm">
            <Link
              href="/admin/to4ka-enrich"
              className="font-medium text-brand-blue hover:underline"
            >
              Прогресс обогащения to4ka →
            </Link>
          </p>
        ) : null}
        {enrichKind ? (
          <div className="mt-4 flex w-full flex-col gap-3">
            <div className="flex flex-wrap items-start gap-2 sm:gap-3">
              <CatalogEnrichAllButton
                kind={enrichKind}
                onItemDone={(id, ok) => {
                  setSessionEnrich((prev) => ({
                    ...prev,
                    [id]: ok ? "ok" : "err",
                  }));
                }}
                onProgressId={(id) => setEnrichCurrentId(id)}
                onIdle={() => setEnrichCurrentId(null)}
              />
              {enrichKind !== "church" ? (
                <CatalogFindDuplicatesButton kind={enrichKind} />
              ) : null}
            </div>
            {Object.keys(sessionEnrich).length > 0 ? (
              <p className="text-xs text-slate-500">
                В этой сессии:{" "}
                <span className="font-medium text-emerald-800">
                  {
                    Object.values(sessionEnrich).filter((v) => v === "ok")
                      .length
                  }{" "}
                  обогащено
                </span>
                {Object.values(sessionEnrich).some((v) => v === "err") ? (
                  <>
                    {" · "}
                    <span className="font-medium text-red-700">
                      {
                        Object.values(sessionEnrich).filter((v) => v === "err")
                          .length
                      }{" "}
                      с ошибкой
                    </span>
                  </>
                ) : null}
                {" — "}
                в списке ниже отмечены зелёным / красным.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <form
        onSubmit={onSearchSubmit}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:p-4"
      >
        <label className="min-w-[160px] flex-1 text-xs font-medium text-slate-500">
          Поиск
          <input
            name="q"
            defaultValue={q}
            placeholder="Название, город, slug…"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
          />
        </label>
        {showGeo ? (
          <>
            <label className="min-w-[7.5rem] text-xs font-medium text-slate-500">
              Штат
              <select
                name="state"
                defaultValue={state}
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-900"
              >
                <option value="">Все</option>
                {(stateOptions ?? []).map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-[9rem] flex-1 text-xs font-medium text-slate-500">
              Округ
              <select
                name="county"
                defaultValue={county}
                disabled={!state || state.startsWith("__")}
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-900 disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">
                  {!state ? "Сначала штат" : "Все"}
                </option>
                {(countyOptions ?? []).map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-[9rem] flex-1 text-xs font-medium text-slate-500">
              Категория
              <select
                name="category"
                defaultValue={category}
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-900"
              >
                <option value="">Все</option>
                {(categoryOptions ?? []).map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Найти
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        {CATALOG_STATUS_OPTIONS.map((opt) => (
          <Link
            key={opt.id}
            href={hrefFor(basePath, { ...baseNext, status: opt.id, page: 1 })}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              status === opt.id
                ? "bg-slate-900 text-white"
                : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {opt.label}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Показано{" "}
          <strong className="text-slate-900">{items.length}</strong> из {total}
          {totalPages > 1 ? ` · стр. ${page}/${totalPages}` : null}
        </p>
        <div className="flex flex-wrap gap-2">
          {CATALOG_SORT_OPTIONS.map((opt) => (
            <Link
              key={opt.id}
              href={hrefFor(basePath, { ...baseNext, sort: opt.id, page: 1 })}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                sort === opt.id
                  ? "bg-slate-200 text-slate-900"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              {opt.label}
            </Link>
          ))}
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-800">
          {error}
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          Нет записей по текущим фильтрам.
        </p>
      ) : layout === "list" ? (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {items.map(({ meta }) => {
            const enrichMark = sessionEnrich[meta.id];
            const isCurrent = enrichCurrentId === meta.id;
            return (
            <li
              key={meta.id}
              className={
                isCurrent
                  ? "flex flex-col gap-2 bg-brand-blue/5 px-3 py-3 ring-1 ring-inset ring-brand-blue/30 sm:flex-row sm:items-center sm:gap-4 sm:px-4"
                  : enrichMark === "ok"
                  ? "flex flex-col gap-2 bg-emerald-50/70 px-3 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-4"
                  : enrichMark === "err"
                    ? "flex flex-col gap-2 bg-red-50/60 px-3 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-4"
                    : "flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-4"
              }
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {meta.title ?? meta.id}
                  </p>
                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                    {meta.statusLabel}
                  </span>
                  {isCurrent ? (
                    <span className="rounded-md bg-brand-blue/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand-blue-deep">
                      сейчас…
                    </span>
                  ) : null}
                  {enrichMark === "ok" ? (
                    <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                      обогащено
                    </span>
                  ) : null}
                  {enrichMark === "err" ? (
                    <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800">
                      ошибка enrich
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {[meta.locationLine, meta.categoryLabel, formatDate(meta.createdAt)]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <ItemActions
                  meta={meta}
                  pending={pending}
                  onArchive={() => {
                    startTransition(async () => {
                      await meta.onArchive?.();
                      router.refresh();
                    });
                  }}
                />
              </div>
            </li>
            );
          })}
        </ul>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(({ meta, card }) => (
            <li
              key={meta.id}
              className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2 px-0.5">
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                  {meta.statusLabel}
                </span>
              </div>
              <div className="min-w-0">{card}</div>
              <div className="mt-auto flex flex-wrap gap-2 border-t border-slate-100 pt-2">
                <ItemActions
                  meta={meta}
                  pending={pending}
                  onArchive={() => {
                    startTransition(async () => {
                      await meta.onArchive?.();
                      router.refresh();
                    });
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {page > 1 ? (
            <Link
              href={hrefFor(basePath, { ...baseNext, page: page - 1 })}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              ← Назад
            </Link>
          ) : null}
          {page < totalPages ? (
            <Link
              href={hrefFor(basePath, { ...baseNext, page: page + 1 })}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              Дальше →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
