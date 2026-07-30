import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminMasterDataPanel } from "@/components/master-data/AdminMasterDataPanel";
import { ErrorState } from "@/components/ui/DataState";
import {
  getAllFeaturesAdmin,
  getAllLanguagesAdmin,
  getBusinessCategoriesAdmin,
  getGeographyCounts,
  getListingCategoriesAdmin,
  getUsStates,
} from "@/lib/master-data/queries";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Master Data — Admin",
};

export default async function AdminMasterDataPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/master-data");
  }

  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    redirect("/");
  }

  let loadError: string | null = null;
  let listingCategories: Awaited<
    ReturnType<typeof getListingCategoriesAdmin>
  > = [];
  let businessCategories: Awaited<
    ReturnType<typeof getBusinessCategoriesAdmin>
  > = [];
  let features: Awaited<ReturnType<typeof getAllFeaturesAdmin>> = [];
  let languages: Awaited<ReturnType<typeof getAllLanguagesAdmin>> = [];
  let states: Awaited<ReturnType<typeof getUsStates>> = [];
  let geographyCounts = {
    countries: 0,
    subdivisions: 0,
    counties: 0,
    cities: 0,
  };

  try {
    [
      listingCategories,
      businessCategories,
      features,
      languages,
      states,
      geographyCounts,
    ] = await Promise.all([
      getListingCategoriesAdmin(supabase),
      getBusinessCategoriesAdmin(supabase),
      getAllFeaturesAdmin(supabase),
      getAllLanguagesAdmin(supabase),
      getUsStates(),
      getGeographyCounts(supabase),
    ]);
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "Не удалось загрузить master data";
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        Legacy URL. Канонический путь IA V2:{" "}
        <a
          href="/admin/system/taxonomy"
          className="font-medium underline hover:no-underline"
        >
          System · Taxonomy
        </a>
      </div>
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Master Data
        </h1>
        <p className="mt-2 text-slate-500">
          Категории, фичи, языки и география платформы.
        </p>
      </div>

      {loadError ? (
        <ErrorState detail={loadError} message="Master Data недоступны" />
      ) : (
        <AdminMasterDataPanel
          businessCategories={businessCategories}
          features={features}
          geographyCounts={geographyCounts}
          languages={languages}
          listingCategories={listingCategories}
          states={states}
        />
      )}
    </div>
  );
}
