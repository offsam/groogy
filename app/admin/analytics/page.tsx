import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminActivityFeed } from "@/components/admin/AdminActivityFeed";
import { AdminAnalyticsPanel } from "@/components/admin/AdminAnalyticsPanel";
import { getAdminActivityFeed } from "@/lib/admin/activity-feed";
import { getAdminAnalytics } from "@/lib/admin/queries";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Активность — Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; actor?: string }>;
}) {
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

  const params = await searchParams;
  let stats: Awaited<ReturnType<typeof getAdminAnalytics>> | null = null;
  let feed: Awaited<ReturnType<typeof getAdminActivityFeed>> | null = null;
  let loadError: string | null = null;
  try {
    [stats, feed] = await Promise.all([
      getAdminAnalytics(supabase),
      getAdminActivityFeed(supabase, {
        kind: params.kind,
        actor: params.actor,
      }),
    ]);
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
          Кто куда зашёл, что нажал и какие контакты открыл.
        </p>
      </div>

      {loadError || !stats || !feed ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-800">
          {loadError ?? "Нет данных"}
        </div>
      ) : (
        <>
          <AdminActivityFeed
            actor={params.actor}
            actorName={feed.actorName}
            items={feed.items}
            kind={params.kind}
          />
          <AdminAnalyticsPanel stats={stats} />
        </>
      )}
    </div>
  );
}
