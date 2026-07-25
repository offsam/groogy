import Link from "next/link";
import type { LechuRewardType } from "@/types/listing";
import { LECHU_REWARD_LABELS } from "@/types/listing";

const REWARD_OPTIONS = (
  Object.entries(LECHU_REWARD_LABELS) as [LechuRewardType, string][]
).map(([value, label]) => ({ value, label }));

type LechuFiltersProps = {
  categories: Array<{ slug: string; nameRu: string }>;
  hubId: string;
  current: {
    category?: string;
    departureCountry?: string;
    destinationCountry?: string;
    rewardType?: string;
    city?: string;
    sort?: string;
  };
};

export function LechuFilters({ categories, hubId, current }: LechuFiltersProps) {
  return (
    <form
      action="/lechu"
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

        <label className="block space-y-1.5 text-sm" htmlFor="filter-departure">
          <span className="font-medium text-slate-700">Откуда</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
            defaultValue={current.departureCountry ?? ""}
            id="filter-departure"
            name="departureCountry"
            placeholder="США"
          />
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="filter-destination">
          <span className="font-medium text-slate-700">Куда</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
            defaultValue={current.destinationCountry ?? ""}
            id="filter-destination"
            name="destinationCountry"
            placeholder="Казахстан"
          />
        </label>

        <label className="block space-y-1.5 text-sm" htmlFor="filter-reward">
          <span className="font-medium text-slate-700">Вознаграждение</span>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
            defaultValue={current.rewardType ?? ""}
            id="filter-reward"
            name="rewardType"
          >
            <option value="">Любое</option>
            {REWARD_OPTIONS.map((opt) => (
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
            <option value="date_asc">Дата вылета ↑</option>
            <option value="date_desc">Дата вылета ↓</option>
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
          href={`/lechu?hub=${encodeURIComponent(hubId)}`}
        >
          Сбросить
        </Link>
      </div>
    </form>
  );
}

export function parseLechuSearchParams(
  searchParams: Record<string, string | undefined>,
) {
  const sortRaw = searchParams.sort;
  const sort =
    sortRaw === "date_asc" || sortRaw === "date_desc"
      ? sortRaw
      : ("newest" as const);

  const rewardRaw = searchParams.rewardType;
  const rewardType = REWARD_OPTIONS.some((o) => o.value === rewardRaw)
    ? (rewardRaw as LechuRewardType)
    : undefined;

  const pageRaw = Number(searchParams.page);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  return {
    categorySlug: searchParams.category || undefined,
    departureCountry: searchParams.departureCountry || undefined,
    destinationCountry: searchParams.destinationCountry || undefined,
    rewardType,
    city: searchParams.city || undefined,
    sort: sort as "newest" | "date_asc" | "date_desc",
    page,
  };
}
