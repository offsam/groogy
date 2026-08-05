"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ExternalLink, Search } from "lucide-react";
import type { ContactRevealBusinessRow } from "@/lib/admin/contact-reveal-queries";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type Props = {
  items: ContactRevealBusinessRow[];
  totalCount: number;
  totalReveals: number;
  page: number;
  pageSize: number;
  initialQ: string;
};

function formatCount(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(n);
}

export function AdminContactRevealsPanel({
  items,
  totalCount,
  totalReveals,
  page,
  pageSize,
  initialQ,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(initialQ);

  useEffect(() => {
    setQ(initialQ);
  }, [initialQ]);

  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  function push(patch: { q?: string; page?: number }) {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    const nextQ = patch.q !== undefined ? patch.q.trim() : initialQ;
    if (nextQ) next.set("q", nextQ);
    else next.delete("q");
    const nextPage = patch.page ?? 1;
    if (nextPage > 1) next.set("page", String(nextPage));
    else next.delete("page");
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    push({ q, page: 1 });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-600">
            Всего открытий:{" "}
            <strong className="tabular-nums text-slate-900">
              {formatCount(totalReveals)}
            </strong>
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Бизнесы с открытиями: {formatCount(totalCount)}
          </p>
        </div>
        <form
          onSubmit={onSearchSubmit}
          className="relative w-full max-w-sm sm:w-72"
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Имя компании…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm text-slate-900"
            aria-label="Найти компанию"
          />
        </form>
      </div>

      {pending ? (
        <p
          className="inline-flex items-center gap-2 text-sm text-brand-blue-deep"
          role="status"
        >
          <BrandPinLoader size="sm" />
          Обновляю…
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
          {initialQ
            ? "Нет бизнесов с таким названием среди открытий контактов."
            : "Пока нет открытий контактов."}
        </p>
      ) : (
        <ol
          className={`divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white ${
            pending ? "opacity-60" : ""
          }`}
        >
          {items.map((row, index) => {
            const rank = (page - 1) * pageSize + index + 1;
            const href = `/business/${row.businessSlug}`;
            return (
              <li key={row.businessId}>
                <Link
                  href={href}
                  className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-slate-50 sm:gap-4 sm:px-4 sm:py-3"
                >
                  <span className="w-7 shrink-0 text-xs font-semibold tabular-nums text-slate-400">
                    {rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {row.businessName}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      /business/{row.businessSlug}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-slate-900">
                    {formatCount(row.reveals)}
                  </span>
                  <ExternalLink
                    className="size-3.5 shrink-0 text-slate-400"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      {totalCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-slate-600">
            {formatCount(from)}–{formatCount(to)} из {formatCount(totalCount)}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1 || pending}
              onClick={() => push({ page: page - 1 })}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-700 disabled:opacity-40"
            >
              Назад
            </button>
            <span className="self-center tabular-nums text-slate-500">
              {page} / {pageCount}
            </span>
            <button
              type="button"
              disabled={page >= pageCount || pending}
              onClick={() => push({ page: page + 1 })}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-700 disabled:opacity-40"
            >
              Дальше
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
