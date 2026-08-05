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
  title: "Taxonomy — System — Admin",
};

export const dynamic = "force-dynamic";

/** IA V2 host for master data / taxonomy. */
export default async function AdminSystemTaxonomyPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/admin/system/taxonomy");
  if (!(await userIsAdmin(supabase))) redirect("/");

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
      <div>
        <p className="text-sm font-medium text-brand-blue-deep">System</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          Taxonomy
        </h1>
        <p className="mt-2 text-slate-500">
          Категории, фичи, языки и география платформы.
        </p>
      </div>

      {loadError ? (
        <ErrorState detail={loadError} message="Taxonomy недоступна" />
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
