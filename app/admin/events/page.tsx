import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminEventsVerificationPanel } from "@/components/admin/AdminEventsVerificationPanel";
import {
  listPendingEventRecommendations,
  listPublishedEvents,
} from "@/lib/events/queries";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "События — верификация — Admin",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function AdminEventsPage({ searchParams }: PageProps) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/events");
  }

  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    redirect("/");
  }

  const params = await searchParams;
  const page = Math.max(1, Number(params.page || "1") || 1);

  let pending: Awaited<
    ReturnType<typeof listPendingEventRecommendations>
  >["items"] = [];
  let pendingTotal = 0;
  let publishedCount = 0;
  let loadError: string | null = null;

  try {
    const [listed, published] = await Promise.all([
      listPendingEventRecommendations(supabase, { page, pageSize: 100 }),
      listPublishedEvents(supabase, { limit: 100 }),
    ]);
    pending = listed.items;
    pendingTotal = listed.total;
    publishedCount = published.length;
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : null;
    loadError = message?.trim() || "Не удалось загрузить события";
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="text-sm font-medium text-brand-blue-deep">Импорт</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          События — верификация
        </h1>
        <p className="mt-2 max-w-3xl text-slate-500">
          Отдельная очередь мероприятий из Facebook (эфиры, митапы, вебинары).
          Profi / «лечу» остаются в рекомендациях.
        </p>
        <p className="mt-3 flex flex-wrap gap-4 text-sm">
          <Link
            href="/admin/recommendations"
            className="text-brand-blue hover:underline"
          >
            ← Рекомендации (profi)
          </Link>
          <Link href="/events" className="text-brand-blue hover:underline">
            Публичная страница /events
          </Link>
        </p>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-800">
          {loadError}
        </div>
      ) : (
        <AdminEventsVerificationPanel
          pending={pending}
          pendingTotal={pendingTotal}
          publishedCount={publishedCount}
        />
      )}
    </div>
  );
}
