import type { Metadata } from "next";
import Link from "next/link";
import { MarketplaceFilters } from "@/components/marketplace/MarketplaceFilters";
import { parseMarketplaceSearchParams } from "@/components/marketplace/parseMarketplaceSearchParams";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { SyncHubCookie } from "@/components/layout/SyncHubCookie";
import { EmptyState, ErrorState } from "@/components/ui/DataState";
import { LISTING_PAGE_SIZE } from "@/lib/listings/constants";
import {
  getListingCategories,
  searchMarketplaceListings,
} from "@/lib/listings/queries";
import { resolveRequestHubs } from "@/lib/regions/request-hub";
import { serializeHubIds } from "@/lib/regions/hubs";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Marketplace — КРУГИ",
  description:
    "Объявления сообщества: купить, продать или отдать вещи в Orange County.",
  alternates: {
    canonical: "/marketplace",
  },
  openGraph: {
    title: "Marketplace — КРУГИ",
    description:
      "Объявления сообщества: купить, продать или отдать вещи в Orange County.",
    type: "website",
  },
};

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function MarketplacePage({ searchParams }: PageProps) {
  const supabase = await createServerClient();
  const rawParams = await searchParams;
  const params = parseMarketplaceSearchParams(rawParams);
  const hubs = await resolveRequestHubs(rawParams.hub);
  const hubIds = serializeHubIds(hubs.map((h) => h.id));

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let categories: Awaited<ReturnType<typeof getListingCategories>> = [];
  let listings: Awaited<ReturnType<typeof searchMarketplaceListings>>["listings"] = [];
  let total = 0;
  let page = params.page;
  let pageSize = LISTING_PAGE_SIZE;
  let loadError: string | null = null;

  try {
    categories = await getListingCategories(supabase, "marketplace");
    const result = await searchMarketplaceListings(
      supabase,
      {
        categorySlug: params.categorySlug,
        transactionType: params.transactionType,
        condition: params.condition,
        city: params.city,
        hubId: hubIds,
        minPrice: params.minPrice,
        maxPrice: params.maxPrice,
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
    loadError = err instanceof Error ? err.message : "Не удалось загрузить каталог";
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
    return q ? `/marketplace?${q}` : "/marketplace";
  }

  return (
    <div className="space-y-8">
      <SyncHubCookie hubId={hubIds} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Marketplace</h1>
          <p className="mt-2 text-slate-500">
            Объявления от участников сообщества — продажа, обмен и бесплатные вещи.
          </p>
        </div>
        <Link
          className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          href="/marketplace/new"
          style={{ color: "#ffffff" }}
        >
          Разместить объявление
        </Link>
      </div>

      <MarketplaceFilters
        categories={categories}
        current={{
          category: rawParams.category,
          transactionType: rawParams.transactionType,
          condition: rawParams.condition,
          city: rawParams.city,
          minPrice: rawParams.minPrice,
          maxPrice: rawParams.maxPrice,
          sort: rawParams.sort,
        }}
        hubId={hubIds}
        total={total}
      />

      {loadError ? (
        <ErrorState detail={loadError} message="Marketplace недоступен" />
      ) : listings.length === 0 ? (
        <EmptyState
          description="Попробуйте изменить фильтры или разместите первое объявление."
          title="Объявлений пока нет"
        />
      ) : (
        <>
          {totalPages > 1 ? (
            <p className="text-sm text-slate-500">
              Страница {page} из {totalPages}
            </p>
          ) : null}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing) => (
              <ListingCard
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
