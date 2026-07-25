import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminAnalyticsPanel } from "@/components/admin/AdminAnalyticsPanel";
import { getAdminAnalytics } from "@/lib/admin/queries";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Аналитика — Admin",
};

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
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          className="text-sm text-slate-500 hover:text-slate-900"
          href="/admin"
        >
          ← Панель управления
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
          Аналитика
        </h1>
        <p className="mt-2 text-slate-500">
          Активность на сайте и состояние каталога.
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
