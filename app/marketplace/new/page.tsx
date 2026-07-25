import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ListingForm } from "@/components/marketplace/ListingForm";
import { ErrorState } from "@/components/ui/DataState";
import {
  getListingCategories,
  getOwnedBusinessesForPublisher,
} from "@/lib/listings/queries";
import { getUsStates } from "@/lib/master-data/queries";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Новое объявление — Marketplace",
};

export default async function NewListingPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/marketplace/new");
  }

  let categories: Awaited<ReturnType<typeof getListingCategories>> = [];
  let ownedBusinesses: Awaited<
    ReturnType<typeof getOwnedBusinessesForPublisher>
  > = [];
  let usStates: Awaited<ReturnType<typeof getUsStates>> = [];
  let loadError: string | null = null;

  try {
    [categories, ownedBusinesses, usStates] = await Promise.all([
      getListingCategories(supabase, "marketplace"),
      getOwnedBusinessesForPublisher(supabase, user.id),
      getUsStates(),
    ]);
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Не удалось загрузить категории";
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Новое объявление
        </h1>
        <p className="mt-2 text-slate-500">
          Товары для продажи, обмена или бесплатно. Услуги — в разделе Услуги.
        </p>
      </div>

      {loadError ? (
        <ErrorState detail={loadError} message="Форма недоступна" />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <ListingForm
            categories={categories}
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
