import Link from "next/link";
import {
  SERVICE_MODE_OPTIONS,
  SERVICE_PRICING_OPTIONS,
} from "@/lib/listings/constants";
import type {
  PublisherType,
  ServiceMode,
  ServicePricingType,
} from "@/types/listing";

type ServicesFiltersProps = {
  categories: Array<{ slug: string; nameRu: string }>;
  hubId: string;
  current: {
    category?: string;
    city?: string;
    pricingType?: string;
    serviceMode?: string;
    publisherType?: string;
    sort?: string;
  };
};

export function ServicesFilters({
  categories,
  hubId,
  current,
}: ServicesFiltersProps) {
  return (
    <form
      action="/services"
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

        <label className="block space-y-1.5 text-sm" htmlFor="filter-pricing">
          <span className="font-medium text-slate-700">Тип цены</span>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
            defaultValue={current.pricingType ?? ""}
            id="filter-pricing"
            name="pricingType"
          >
            <option value="">Любой</option>
            {SERVICE_PRICING_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="filter-mode">
          <span className="font-medium text-slate-700">Формат</span>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
            defaultValue={current.serviceMode ?? ""}
            id="filter-mode"
            name="serviceMode"
          >
            <option value="">Любой</option>
            {SERVICE_MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="filter-provider">
          <span className="font-medium text-slate-700">Исполнитель</span>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
            defaultValue={current.publisherType ?? ""}
            id="filter-provider"
            name="publisherType"
          >
            <option value="">Любой</option>
            <option value="profile">Частное лицо</option>
            <option value="business">Бизнес</option>
          </select>
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
            <option value="price_asc">Цена ↑</option>
            <option value="price_desc">Цена ↓</option>
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
          href={`/services?hub=${encodeURIComponent(hubId)}`}
        >
          Сбросить
        </Link>
      </div>
    </form>
  );
}

export function parseServicesSearchParams(
  searchParams: Record<string, string | undefined>,
) {
  const sortRaw = searchParams.sort;
  const sort =
    sortRaw === "price_asc" || sortRaw === "price_desc"
      ? sortRaw
      : ("newest" as const);

  const pricingRaw = searchParams.pricingType;
  const pricingType = SERVICE_PRICING_OPTIONS.some((o) => o.value === pricingRaw)
    ? (pricingRaw as ServicePricingType)
    : undefined;

  const modeRaw = searchParams.serviceMode;
  const serviceMode = SERVICE_MODE_OPTIONS.some((o) => o.value === modeRaw)
    ? (modeRaw as ServiceMode)
    : undefined;

  const publisherRaw = searchParams.publisherType;
  const publisherType =
    publisherRaw === "profile" || publisherRaw === "business"
      ? (publisherRaw as PublisherType)
      : undefined;

  const pageRaw = Number(searchParams.page);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  return {
    categorySlug: searchParams.category || undefined,
    city: searchParams.city || undefined,
    pricingType,
    serviceMode,
    publisherType,
    sort: sort as "newest" | "price_asc" | "price_desc",
    page,
  };
}
