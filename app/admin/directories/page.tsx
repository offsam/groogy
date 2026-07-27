import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BookMarked } from "lucide-react";
import { DIRECTORY_SOURCE_LIST } from "@/lib/import-review/directory-sources";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import { getAdminDashboardCounts } from "@/lib/admin/queries";

export const metadata: Metadata = {
  title: "Справочники — Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminDirectoriesIndexPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/directories");
  }

  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    redirect("/");
  }

  const counts = await getAdminDashboardCounts(supabase).catch(() => null);
  const bySource = counts?.directoryPendingBySource ?? {};

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-sm font-medium text-amber-800">Импорт · справочники</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          Внешние справочники
        </h1>
        <p className="mt-2 max-w-2xl text-slate-500">
          Отдельная очередь на каждый источник. Карточки в превью платформы —
          пока только админ-проверка перед переносом в каталог.
        </p>
        <p className="mt-3">
          <Link href="/admin" className="text-sm text-brand-blue hover:underline">
            ← Админ-панель
          </Link>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DIRECTORY_SOURCE_LIST.map((source) => {
          const count = bySource[source.id] ?? 0;
          return (
            <Link
              key={source.id}
              href={`/admin/directories/${source.slug}`}
              className="group rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-brand-blue/40 hover:shadow-sm"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 rounded-lg bg-brand-yellow/20 p-2 text-amber-900">
                  <BookMarked className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-slate-900 group-hover:text-brand-blue">
                    {source.title}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">{source.description}</p>
                  <p className="mt-3 text-sm font-medium text-slate-700">
                    {count} в очереди
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
