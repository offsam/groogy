import type { Metadata } from "next";
import Link from "next/link";
import {
  TransfersFilters,
  parseTransfersSearchParams,
} from "@/components/transfers/TransfersFilters";
import { TransferCard } from "@/components/transfers/TransferCard";
import { SyncHubCookie } from "@/components/layout/SyncHubCookie";
import { EmptyState, ErrorState } from "@/components/ui/DataState";
import { LISTING_PAGE_SIZE } from "@/lib/listings/constants";
import {
  getListingCategories,
  searchTransferListings,
} from "@/lib/listings/queries";
import { resolveRequestHubs } from "@/lib/regions/request-hub";
import { serializeHubIds } from "@/lib/regions/hubs";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Переводы — КРУГИ",
  description:
    "Переводы денег между странами: банковские, крипто и наличные от участников сообщества.",
  alternates: {
    canonical: "/transfers",
  },
  openGraph: {
    title: "Переводы — КРУГИ",
    description:
      "Переводы денег между странами: банковские, крипто и наличные от участников сообщества.",
    type: "website",
  },
};

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function TransfersPage({ searchParams }: PageProps) {
  const supabase = await createServerClient();
  const rawParams = await searchParams;
  const params = parseTransfersSearchParams(rawParams);
  const hubs = await resolveRequestHubs(rawParams.hub);
  const hubIds = serializeHubIds(hubs.map((h) => h.id));

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let categories: Awaited<ReturnType<typeof getListingCategories>> = [];
  let listings: Awaited<ReturnType<typeof searchTransferListings>>["listings"] =
    [];
  let total = 0;
  let page = params.page;
  let pageSize = LISTING_PAGE_SIZE;
  let loadError: string | null = null;

  try {
    categories = await getListingCategories(supabase, "transfers");
    const result = await searchTransferListings(
      supabase,
      {
        categorySlug: params.categorySlug,
        fromCountry: params.fromCountry,
        toCountry: params.toCountry,
        transferMethod: params.transferMethod,
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
    if (err instanceof Error) {
      loadError = err.message;
    } else if (err && typeof err === "object" && "message" in err) {
      const e = err as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
      loadError = [e.code, e.message, e.details, e.hint].filter(Boolean).join(" — ") || "Не удалось загрузить каталог";
    } else {
      loadError = "Не удалось загрузить каталог";
    }
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
    return q ? `/transfers?${q}` : "/transfers";
  }

  return (
    <div className="space-y-8">
      <SyncHubCookie hubId={hubIds} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Переводы
          </h1>
          <p className="mt-2 text-slate-500">
            Переводы денег между странами — банк, крипто, наличные.
          </p>
        </div>
        <Link
          className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          href="/transfers/new"
          style={{ color: "#ffffff" }}
        >
          Предложить перевод
        </Link>
      </div>

      <TransfersFilters
        categories={categories}
        current={{
          category: rawParams.category,
          fromCountry: rawParams.fromCountry,
          toCountry: rawParams.toCountry,
          transferMethod: rawParams.transferMethod,
          city: rawParams.city,
          sort: rawParams.sort,
        }}
        hubId={hubIds}
      />

      {loadError ? (
        <ErrorState detail={loadError} message="Каталог переводов недоступен" />
      ) : listings.length === 0 ? (
        <EmptyState
          description="Попробуйте изменить фильтры или разместите первое предложение."
          title="Переводов пока нет"
        />
      ) : (
        <>
          <p className="text-sm text-slate-500">
            Найдено: {total} · страница {page} из {totalPages}
          </p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing) => (
              <TransferCard
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
