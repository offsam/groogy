import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ServiceForm } from "@/components/services/ServiceForm";
import { ErrorState } from "@/components/ui/DataState";
import { canEditListing } from "@/lib/listings/permissions";
import {
  getListingById,
  getListingCategories,
  getOwnedBusinessesForPublisher,
} from "@/lib/listings/queries";
import { getLanguages, getUsStates } from "@/lib/master-data/queries";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Редактирование услуги — Услуги",
  robots: { index: false, follow: false },
};

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditServicePage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/services/${id}/edit`);
  }

  let listing: Awaited<ReturnType<typeof getListingById>> = null;
  let categories: Awaited<ReturnType<typeof getListingCategories>> = [];
  let ownedBusinesses: Awaited<
    ReturnType<typeof getOwnedBusinessesForPublisher>
  > = [];
  let usStates: Awaited<ReturnType<typeof getUsStates>> = [];
  let languages: Awaited<ReturnType<typeof getLanguages>> = [];
  let loadError: string | null = null;

  try {
    [listing, categories, ownedBusinesses, usStates, languages] =
      await Promise.all([
        getListingById(supabase, id, user.id),
        getListingCategories(supabase, "services"),
        getOwnedBusinessesForPublisher(supabase, user.id),
        getUsStates(),
        getLanguages(),
      ]);
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Не удалось загрузить услугу";
  }

  if (loadError) {
    return <ErrorState detail={loadError} message="Редактирование недоступно" />;
  }

  if (!listing || listing.listingType !== "service") {
    notFound();
  }

  if (!canEditListing(listing, user.id)) {
    redirect(`/services/${id}`);
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
        <ServiceForm
          categories={categories}
          initial={listing}
          languages={languages}
          listingId={id}
          mode="edit"
          ownedBusinesses={ownedBusinesses}
          usStates={usStates}
          userId={user.id}
        />
      </div>
    </div>
  );
}
