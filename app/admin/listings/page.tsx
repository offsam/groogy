import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminListingsPanel } from "@/components/marketplace/AdminListingsPanel";
import { createServerClient } from "@/lib/supabase/server";
import { getAdminListings, getListingReports } from "@/lib/listings/queries";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Модерация объявлений — Admin",
};

const ALLOWED_FILTERS = [
  "all",
  "active",
  "reported",
  "removed",
  "rejected",
  "completed",
  "paused",
];
const ALLOWED_DOMAINS = ["all", "marketplace", "services"];

type PageProps = {
  searchParams: Promise<{ filter?: string; q?: string; domain?: string }>;
};

export default async function AdminListingsPage({ searchParams }: PageProps) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/listings");
  }

  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    redirect("/");
  }

  const params = await searchParams;
  const filter = ALLOWED_FILTERS.includes(params.filter ?? "")
    ? (params.filter ?? "all")
    : "all";
  const domain = ALLOWED_DOMAINS.includes(params.domain ?? "")
    ? (params.domain as "all" | "marketplace" | "services")
    : "all";
  const q = params.q ?? "";

  let listings: Awaited<ReturnType<typeof getAdminListings>> = [];
  let reportsByListingId: Record<
    string,
    Awaited<ReturnType<typeof getListingReports>>
  > = {};
  let loadError: string | null = null;

  try {
    listings = await getAdminListings(supabase, filter, q || null, domain);

    const reportEntries = await Promise.all(
      listings.map(async (listing) => {
        const reports = await getListingReports(supabase, listing.id);
        return [listing.id, reports] as const;
      }),
    );
    reportsByListingId = Object.fromEntries(reportEntries);
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Не удалось загрузить объявления";
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Модерация объявлений
        </h1>
        <p className="mt-2 text-slate-500">
          Управление Marketplace и Услугами: статусы, жалобы, восстановление.
        </p>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-800">
          {loadError}
          <p className="mt-2 text-red-600">
            Если миграция ещё не применена — это ожидаемо.
          </p>
        </div>
      ) : (
        <AdminListingsPanel
          domain={domain}
          filter={filter}
          listings={listings}
          reportsByListingId={reportsByListingId}
          searchQuery={q}
        />
      )}
    </div>
  );
}
