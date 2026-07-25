import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TransferForm } from "@/components/transfers/TransferForm";
import { ErrorState } from "@/components/ui/DataState";
import {
  getListingCategories,
  getOwnedBusinessesForPublisher,
} from "@/lib/listings/queries";
import { getUsStates } from "@/lib/master-data/queries";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Новый перевод — Переводы",
};

export default async function NewTransferPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/transfers/new");
  }

  let categories: Awaited<ReturnType<typeof getListingCategories>> = [];
  let ownedBusinesses: Awaited<
    ReturnType<typeof getOwnedBusinessesForPublisher>
  > = [];
  let usStates: Awaited<ReturnType<typeof getUsStates>> = [];
  let loadError: string | null = null;

  try {
    [categories, ownedBusinesses, usStates] = await Promise.all([
      getListingCategories(supabase, "transfers"),
      getOwnedBusinessesForPublisher(supabase, user.id),
      getUsStates(),
    ]);
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "Не удалось загрузить форму";
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Новый перевод
        </h1>
        <p className="mt-2 text-slate-500">
          Укажите маршрут, способ и комиссию — сохраните черновик или опубликуйте.
        </p>
      </div>

      {loadError ? (
        <ErrorState detail={loadError} message="Форма недоступна" />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <TransferForm
            categories={categories}
            mode="create"
            ownedBusinesses={ownedBusinesses}
            usStates={usStates}
          />
        </div>
      )}
    </div>
  );
}
