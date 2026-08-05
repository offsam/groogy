import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AdminContactRevealsPanel } from "@/components/admin/AdminContactRevealsPanel";
import { listContactRevealBusinesses } from "@/lib/admin/contact-reveal-queries";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Открытия контактов — Admin",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ q?: string; page?: string }>;
};

export default async function AdminContactRevealsPage({
  searchParams,
}: PageProps) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/admin/contact-reveals");
  if (!(await userIsAdmin(supabase))) redirect("/");

  const params = await searchParams;
  const q = params.q?.trim() || "";
  const page = Math.max(1, Number(params.page) || 1);

  let loadError: string | null = null;
  let leaderboard = {
    items: [] as Awaited<ReturnType<typeof listContactRevealBusinesses>>["items"],
    totalCount: 0,
    totalReveals: 0,
    page,
    pageSize: 20,
  };

  try {
    leaderboard = await listContactRevealBusinesses(supabase, {
      q: q || undefined,
      page,
      pageSize: 20,
    });
  } catch (err) {
    loadError =
      err instanceof Error
        ? err.message
        : "Не удалось загрузить открытия контактов";
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 sm:space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          Открытия контактов
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Бизнесы, у которых чаще всего нажимают «Показать контакты». Сверху —
          самые кликабельные.
        </p>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-800">
          {loadError}
          <p className="mt-2 text-xs text-red-700">
            Если миграция ещё не применена — запусти{" "}
            <code className="rounded bg-red-100 px-1">
              20260802163000_admin_contact_reveal_leaderboard.sql
            </code>
            .
          </p>
        </div>
      ) : (
        <Suspense fallback={<p className="text-sm text-slate-500">Загрузка…</p>}>
          <AdminContactRevealsPanel
            items={leaderboard.items}
            totalCount={leaderboard.totalCount}
            totalReveals={leaderboard.totalReveals}
            page={leaderboard.page}
            pageSize={leaderboard.pageSize}
            initialQ={q}
          />
        </Suspense>
      )}
    </div>
  );
}
