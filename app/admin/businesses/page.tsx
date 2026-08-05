import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminBusinessesPanel } from "@/components/business/AdminBusinessesPanel";
import {
  findDuplicatePairs,
  getAdminBusinesses,
  getAdminBusinessStatusCounts,
} from "@/lib/business/admin-queries";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Бизнесы на проверке — Admin",
};

export default async function AdminBusinessesPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/businesses");
  }

  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    redirect("/");
  }

  let businesses: Awaited<ReturnType<typeof getAdminBusinesses>> = [];
  let statusCounts: Awaited<
    ReturnType<typeof getAdminBusinessStatusCounts>
  > | null = null;
  let loadError: string | null = null;

  try {
    [businesses, statusCounts] = await Promise.all([
      getAdminBusinesses(supabase),
      getAdminBusinessStatusCounts(supabase),
    ]);
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Не удалось загрузить бизнесы";
  }

  const pairs = findDuplicatePairs(businesses);
  const reviewCount =
    statusCounts?.review ??
    businesses.filter((b) => b.status === "pending" || b.status === "draft")
      .length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Бизнесы на проверке
        </h1>
        <p className="mt-2 text-slate-500">
          На проверке (pending + draft): {reviewCount}
          {statusCounts
            ? ` · pending ${statusCounts.pending} · draft ${statusCounts.draft}`
            : null}
          . Вкладки ниже — по статусу.
        </p>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-800">
          {loadError}
          <p className="mt-2 text-red-600">
            Если миграция admin merge ещё не применена — это ожидаемо.
          </p>
        </div>
      ) : (
        <AdminBusinessesPanel businesses={businesses} pairs={pairs} />
      )}
    </div>
  );
}
