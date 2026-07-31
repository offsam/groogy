"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition, type FormEvent, type ReactNode } from "react";
import { AdminPublishedDuplicatesButton } from "@/components/admin/AdminPublishedDuplicatesButton";
import { AdminEntitySourcesButton } from "@/components/admin/AdminEntitySourcesButton";
import { AdminPublishedEnrichButton } from "@/components/admin/AdminPublishedEnrichButton";
import { AdminPasteEnrichButton } from "@/components/admin/AdminPasteEnrichButton";
import {
  CATALOG_SORT_OPTIONS,
  CATALOG_STATUS_OPTIONS,
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
           | "lechu";
  slug?: string | null;
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
  /** Rendered card preview for each item */
  items: Array<{
    meta: CatalogBrowserItem;
    card: ReactNode;
  }>;
  error?: string | null;
};

function hrefFor(
  basePath: string,
  next: {
    q?: string;
    status?: string;
    sort?: string;
    page?: number;
  },
) {
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.status && next.status !== "published") params.set("status", next.status);
  if (next.sort && next.sort !== "newest") params.set("sort", next.sort);
  if (next.page && next.page > 1) params.set("page", String(next.page));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
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
  items,
  error,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function onSearchSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const nextQ = String(new FormData(form).get("q") ?? "").trim();
    router.push(hrefFor(basePath, { q: nextQ, status, sort, page: 1 }));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="text-sm font-medium text-brand-blue-deep">Catalog</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          {title}
        </h1>
        <p className="mt-2 max-w-3xl text-slate-500">{description}</p>
        <p className="mt-3 flex flex-wrap gap-4 text-sm">
          <Link href="/admin/catalog" className="text-brand-blue hover:underline">
            ← Catalog
          </Link>
          {legacyHref ? (
            <Link href={legacyHref} className="text-brand-blue hover:underline">
              {legacyLabel ?? "Legacy tool"}
            </Link>
          ) : null}
        </p>
      </div>

      <form
        onSubmit={onSearchSubmit}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
      >
        <label className="min-w-[200px] flex-1 text-xs font-medium text-slate-500">
          Search
          <input
            name="q"
            defaultValue={q}
            placeholder="Name, city, slug…"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Find
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        {CATALOG_STATUS_OPTIONS.map((opt) => (
          <Link
            key={opt.id}
            href={hrefFor(basePath, { q, status: opt.id, sort, page: 1 })}
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
          <strong className="text-slate-900">
            {items.length}
          </strong>{" "}
          из {total}
          {totalPages > 1 ? ` · стр. ${page}/${totalPages}` : null}
        </p>
        <div className="flex flex-wrap gap-2">
          {CATALOG_SORT_OPTIONS.map((opt) => (
            <Link
              key={opt.id}
              href={hrefFor(basePath, { q, status, sort: opt.id, page: 1 })}
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
                {meta.publicHref ? (
                  <Link
                    href={meta.publicHref}
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Public
                  </Link>
                ) : null}
                {meta.publicHref ? (
                  <Link
                    href={meta.publicHref}
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                  >
                    View
                  </Link>
                ) : null}
                {meta.editHref ? (
                  <Link
                    href={meta.editHref}
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                  >
                    Edit
                  </Link>
                ) : (
                  <span
                    className="rounded-lg border border-dashed border-slate-200 px-2.5 py-1.5 text-xs text-slate-400"
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
                      meta.enrichKind === "professional") &&
                    meta.slug ? (
                      <AdminPasteEnrichButton
                        entityId={meta.id}
                        kind={meta.enrichKind}
                        slug={meta.slug}
                      />
                    ) : null}
                    <AdminPublishedDuplicatesButton
                      entityId={meta.id}
                      kind={meta.enrichKind}
                      slug={meta.slug}
                    />
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
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    onClick={() => {
                      startTransition(async () => {
                        await meta.onArchive?.();
                        router.refresh();
                      });
                    }}
                  >
                    Archive
                  </button>
                ) : (
                  <span
                    className="rounded-lg border border-dashed border-slate-200 px-2.5 py-1.5 text-xs text-slate-400"
                    title="Coming Soon"
                  >
                    Archive · Soon
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {page > 1 ? (
            <Link
              href={hrefFor(basePath, { q, status, sort, page: page - 1 })}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              ← Prev
            </Link>
          ) : null}
          {page < totalPages ? (
            <Link
              href={hrefFor(basePath, { q, status, sort, page: page + 1 })}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              Next →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
