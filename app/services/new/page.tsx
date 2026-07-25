import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ServiceForm } from "@/components/services/ServiceForm";
import { ErrorState } from "@/components/ui/DataState";
import {
  getListingCategories,
  getOwnedBusinessesForPublisher,
} from "@/lib/listings/queries";
import { getLanguages, getUsStates } from "@/lib/master-data/queries";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Новая услуга — Услуги",
};

export default async function NewServicePage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/services/new");
  }

  let categories: Awaited<ReturnType<typeof getListingCategories>> = [];
  let ownedBusinesses: Awaited<
    ReturnType<typeof getOwnedBusinessesForPublisher>
  > = [];
  let usStates: Awaited<ReturnType<typeof getUsStates>> = [];
  let languages: Awaited<ReturnType<typeof getLanguages>> = [];
  let loadError: string | null = null;

  try {
    [categories, ownedBusinesses, usStates, languages] = await Promise.all([
      getListingCategories(supabase, "services"),
      getOwnedBusinessesForPublisher(supabase, user.id),
      getUsStates(),
      getLanguages(),
    ]);
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Не удалось загрузить форму";
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Новая услуга
        </h1>
        <p className="mt-2 text-slate-500">
          Заполните форму и сохраните черновик или опубликуйте сразу.
        </p>
      </div>

      {loadError ? (
        <ErrorState detail={loadError} message="Форма недоступна" />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <ServiceForm
            categories={categories}
            languages={languages}
            mode="create"
            ownedBusinesses={ownedBusinesses}
            usStates={usStates}
            userId={user.id}
          />
        </div>
      )}
    </div>
  );
}
