import Link from "next/link";
import type { TransferMethod } from "@/types/listing";
import { TRANSFER_METHOD_LABELS } from "@/types/listing";

const TRANSFER_METHOD_OPTIONS = (
  Object.entries(TRANSFER_METHOD_LABELS) as [TransferMethod, string][]
).map(([value, label]) => ({ value, label }));

type TransfersFiltersProps = {
  categories: Array<{ slug: string; nameRu: string }>;
  hubId: string;
  current: {
    category?: string;
    fromCountry?: string;
    toCountry?: string;
    transferMethod?: string;
    city?: string;
    sort?: string;
  };
};

export function TransfersFilters({
  categories,
  hubId,
  current,
}: TransfersFiltersProps) {
  return (
    <form
      action="/transfers"
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6"
      method="get"
    >
      <input name="hub" type="hidden" value={hubId} />
      <h2 className="text-lg font-semibold text-slate-900">Фильтры</h2>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block space-y-1.5 text-sm" htmlFor="filter-category">
          <span className="font-medium text-slate-700">Категория</span>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
            defaultValue={current.category ?? ""}
            id="filter-category"
            name="category"
          >
            <option value="">Все категории</option>
            {categories.map((cat) => (
              <option key={cat.slug} value={cat.slug}>
                {cat.nameRu}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="filter-from">
          <span className="font-medium text-slate-700">Откуда</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
            defaultValue={current.fromCountry ?? ""}
            id="filter-from"
            name="fromCountry"
            placeholder="США"
          />
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="filter-to">
          <span className="font-medium text-slate-700">Куда</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
            defaultValue={current.toCountry ?? ""}
            id="filter-to"
            name="toCountry"
            placeholder="Россия"
          />
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="filter-method">
          <span className="font-medium text-slate-700">Способ перевода</span>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
            defaultValue={current.transferMethod ?? ""}
            id="filter-method"
            name="transferMethod"
          >
            <option value="">Любой</option>
            {TRANSFER_METHOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="filter-city">
          <span className="font-medium text-slate-700">Город</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
            defaultValue={current.city ?? ""}
            id="filter-city"
            name="city"
            placeholder="Например, Irvine"
          />
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="filter-sort">
          <span className="font-medium text-slate-700">Сортировка</span>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
            defaultValue={current.sort ?? "newest"}
            id="filter-sort"
            name="sort"
          >
            <option value="newest">Сначала новые</option>
            <option value="fee_asc">Комиссия ↑</option>
            <option value="fee_desc">Комиссия ↓</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          Применить
        </button>
        <Link
          className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900"
          href={`/transfers?hub=${encodeURIComponent(hubId)}`}
        >
          Сбросить
        </Link>
      </div>
    </form>
  );
}

export function parseTransfersSearchParams(
  searchParams: Record<string, string | undefined>,
) {
  const sortRaw = searchParams.sort;
  const sort =
    sortRaw === "fee_asc" || sortRaw === "fee_desc"
      ? sortRaw
      : ("newest" as const);

  const methodRaw = searchParams.transferMethod;
  const transferMethod = TRANSFER_METHOD_OPTIONS.some((o) => o.value === methodRaw)
    ? (methodRaw as TransferMethod)
    : undefined;

  const pageRaw = Number(searchParams.page);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  return {
    categorySlug: searchParams.category || undefined,
    fromCountry: searchParams.fromCountry || undefined,
    toCountry: searchParams.toCountry || undefined,
    transferMethod,
    city: searchParams.city || undefined,
    sort: sort as "newest" | "fee_asc" | "fee_desc",
    page,
  };
}
