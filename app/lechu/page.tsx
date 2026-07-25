import type { Metadata } from "next";
import Link from "next/link";
import {
  LechuFilters,
  parseLechuSearchParams,
} from "@/components/lechu/LechuFilters";
import { LechuCard } from "@/components/lechu/LechuCard";
import { SyncHubCookie } from "@/components/layout/SyncHubCookie";
import { EmptyState, ErrorState } from "@/components/ui/DataState";
import { LISTING_PAGE_SIZE } from "@/lib/listings/constants";
import {
  getListingCategories,
  searchLechuListings,
} from "@/lib/listings/queries";
import { resolveRequestHubs } from "@/lib/regions/request-hub";
import { serializeHubIds } from "@/lib/regions/hubs";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Лечу — КРУГИ",
  description:
    "Путешественники, которые могут взять документы или посылки в другие страны.",
  alternates: {
    canonical: "/lechu",
  },
  openGraph: {
    title: "Лечу — КРУГИ",
    description:
      "Путешественники, которые могут взять документы или посылки в другие страны.",
    type: "website",
  },
};

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function LechuPage({ searchParams }: PageProps) {
  const supabase = await createServerClient();
  const rawParams = await searchParams;
  const params = parseLechuSearchParams(rawParams);
  const hubs = await resolveRequestHubs(rawParams.hub);
  const hubIds = serializeHubIds(hubs.map((h) => h.id));

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let categories: Awaited<ReturnType<typeof getListingCategories>> = [];
  let listings: Awaited<ReturnType<typeof searchLechuListings>>["listings"] =
    [];
  let total = 0;
  let page = params.page;
  let pageSize = LISTING_PAGE_SIZE;
  let loadError: string | null = null;

  try {
    categories = await getListingCategories(supabase, "lechu");
    const result = await searchLechuListings(
      supabase,
      {
        categorySlug: params.categorySlug,
        departureCountry: params.departureCountry,
        destinationCountry: params.destinationCountry,
        rewardType: params.rewardType,
        city: params.city,
        hubId: hubIds,
        sort: params.sort,
        page: params.page,
        pageSize: LISTING_PAGE_SIZE,
      },
      user?.id ?? null,
    );
    listings = result.listings;
    total = result.total;
    page = result.page;
    pageSize = result.pageSize;
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "Не удалось загрузить каталог";
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function pageHref(nextPage: number) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(rawParams)) {
      if (value && key !== "page") qs.set(key, value);
    }
    if (!qs.has("hub")) qs.set("hub", hubIds);
    if (nextPage > 1) qs.set("page", String(nextPage));
    const q = qs.toString();
    return q ? `/lechu?${q}` : "/lechu";
  }

  return (
    <div className="space-y-8">
      <SyncHubCookie hubId={hubIds} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Лечу
          </h1>
          <p className="mt-2 text-slate-500">
            Кто летит и может взять документы или посылку в другую страну.
          </p>
        </div>
        <Link
          className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          href="/lechu/new"
          style={{ color: "#ffffff" }}
        >
          Я лечу
        </Link>
      </div>

      <LechuFilters
        categories={categories}
        current={{
          category: rawParams.category,
          departureCountry: rawParams.departureCountry,
          destinationCountry: rawParams.destinationCountry,
          rewardType: rawParams.rewardType,
          city: rawParams.city,
          sort: rawParams.sort,
        }}
        hubId={hubIds}
      />

      {loadError ? (
        <ErrorState detail={loadError} message="Каталог «Лечу» недоступен" />
      ) : listings.length === 0 ? (
        <EmptyState
          description="Попробуйте изменить фильтры или разместите первое объявление."
          title="Объявлений пока нет"
        />
      ) : (
        <>
          <p className="text-sm text-slate-500">
            Найдено: {total} · страница {page} из {totalPages}
          </p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing) => (
              <LechuCard
                key={listing.id}
                listing={listing}
                showFavorite={Boolean(user)}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <nav
              aria-label="Пагинация"
              className="flex flex-wrap items-center justify-center gap-2"
            >
              {page > 1 && (
                <Link
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
                  href={pageHref(page - 1)}
                >
                  ← Назад
                </Link>
              )}
              {page < totalPages && (
                <Link
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
                  href={pageHref(page + 1)}
                >
                  Далее →
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
