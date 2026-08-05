import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminAnalyticsPanel } from "@/components/admin/AdminAnalyticsPanel";
import { getAdminAnalytics } from "@/lib/admin/queries";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Активность — Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/analytics");
  }

  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    redirect("/");
  }

  let stats: Awaited<ReturnType<typeof getAdminAnalytics>> | null = null;
  let loadError: string | null = null;
  try {
    stats = await getAdminAnalytics(supabase);
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Не удалось загрузить";
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Активность
        </h1>
        <p className="mt-1 text-sm text-slate-500 sm:mt-2 sm:text-base">
          Трафик, открытия контактов и рост — для тебя и для разговора с
          бизнесами.
        </p>
      </div>

      {loadError || !stats ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-800">
          {loadError ?? "Нет данных"}
        </div>
      ) : (
        <AdminAnalyticsPanel stats={stats} />
      )}
    </div>
  );
}
