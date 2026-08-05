import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminClaimsPanel } from "@/components/admin/AdminClaimsPanel";
import {
  getPendingBusinessClaims,
  getPendingEventClaims,
  getPendingJobClaims,
  getPendingListingClaims,
  getPendingProfessionalClaims,
} from "@/lib/admin/claim-actions";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Заявки на владение — КРУГИ",
};

export default async function AdminClaimsPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/claims");
  const isAdmin = await userIsAdmin(supabase).catch(() => false);
  if (!isAdmin) redirect("/");

  const [
    businessClaims,
    professionalClaims,
    listingClaims,
    eventClaims,
    jobClaims,
  ] = await Promise.all([
    getPendingBusinessClaims(),
    getPendingProfessionalClaims(),
    getPendingListingClaims(),
    getPendingEventClaims(),
    getPendingJobClaims(),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-0">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Заявки на владение
        </h1>
        <p className="text-sm text-slate-600">
          Проверьте доказательства и одобрите владельца карточки: бизнес,
          специалист, объявление, событие или вакансия.
        </p>
      </header>
      <AdminClaimsPanel
        businessClaims={businessClaims}
        eventClaims={eventClaims}
        jobClaims={jobClaims}
        listingClaims={listingClaims}
        professionalClaims={professionalClaims}
      />
    </div>
  );
}
