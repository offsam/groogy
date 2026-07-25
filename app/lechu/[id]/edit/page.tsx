import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LechuForm } from "@/components/lechu/LechuForm";
import { ErrorState } from "@/components/ui/DataState";
import { canEditListing } from "@/lib/listings/permissions";
import {
  getListingById,
  getListingCategories,
  getOwnedBusinessesForPublisher,
} from "@/lib/listings/queries";
import { getUsStates } from "@/lib/master-data/queries";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Редактирование — Лечу",
  robots: { index: false, follow: false },
};

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditLechuPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/lechu/${id}/edit`);
  }

  let listing: Awaited<ReturnType<typeof getListingById>> = null;
  let categories: Awaited<ReturnType<typeof getListingCategories>> = [];
  let ownedBusinesses: Awaited<
    ReturnType<typeof getOwnedBusinessesForPublisher>
  > = [];
  let usStates: Awaited<ReturnType<typeof getUsStates>> = [];
  let loadError: string | null = null;

  try {
    [listing, categories, ownedBusinesses, usStates] = await Promise.all([
      getListingById(supabase, id, user.id),
      getListingCategories(supabase, "lechu"),
      getOwnedBusinessesForPublisher(supabase, user.id),
      getUsStates(),
    ]);
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "Не удалось загрузить объявление";
  }

  if (loadError) {
    return (
      <ErrorState detail={loadError} message="Редактирование недоступно" />
    );
  }

  if (!listing || listing.listingType !== "transport_carry") {
    notFound();
  }

  if (!canEditListing(listing, user.id)) {
    redirect(`/lechu/${id}`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Редактирование
        </h1>
        <p className="mt-2 text-slate-500">{listing.title}</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <LechuForm
          categories={categories}
          initial={listing}
          listingId={id}
          mode="edit"
          ownedBusinesses={ownedBusinesses}
          usStates={usStates}
        />
      </div>
    </div>
  );
}
