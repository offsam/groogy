import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageCircle } from "lucide-react";
import {
  TELEGRAM_SOURCE_LIST,
  TELEGRAM_CA_CITY_SOURCE_IDS,
} from "@/lib/import-review/telegram-sources";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import { getAdminDashboardCounts } from "@/lib/admin/queries";

export const metadata: Metadata = {
  title: "Telegram-группы — Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminTelegramGroupsIndexPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/telegram-groups");
  }

  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    redirect("/");
  }

  const counts = await getAdminDashboardCounts(supabase).catch(() => null);
  const bySource = counts?.telegramPendingBySource ?? {};

  const citySources = TELEGRAM_SOURCE_LIST.filter((s) =>
    TELEGRAM_CA_CITY_SOURCE_IDS.includes(s.id),
  );
  const legacySources = TELEGRAM_SOURCE_LIST.filter(
    (s) => !TELEGRAM_CA_CITY_SOURCE_IDS.includes(s.id),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <p className="text-sm font-medium text-brand-blue">Импорт · Telegram</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          Telegram-группы
        </h1>
        <p className="mt-2 max-w-2xl text-slate-500">
          Отдельная очередь на каждую группу: контакты, упоминания, категории —
          как у уже обогащённых Fun for Mom / LA.
        </p>
        <p className="mt-3">
          <Link href="/admin" className="text-sm text-brand-blue hover:underline">
            ← Админ-панель
          </Link>
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">
          California · Sacramento / SF / San Diego
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {citySources.map((source) => {
            const count = bySource[source.id] ?? 0;
            return (
              <Link
                key={source.id}
                href={`/admin/telegram-groups/${source.slug}`}
                className="group rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-brand-blue/40 hover:shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 rounded-lg bg-brand-blue/10 p-2 text-brand-blue">
                    <MessageCircle className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-900 group-hover:text-brand-blue">
                      {source.title}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {source.description}
                    </p>
                    <p className="mt-3 text-sm font-medium text-slate-700">
                      {count} в очереди
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Уже в пайплайне</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {legacySources.map((source) => {
            const count = bySource[source.id] ?? 0;
            return (
              <Link
                key={source.id}
                href={`/admin/telegram-groups/${source.slug}`}
                className="group rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-brand-blue/40 hover:shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 rounded-lg bg-slate-100 p-2 text-slate-700">
                    <MessageCircle className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-900 group-hover:text-brand-blue">
                      {source.title}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {source.description}
                    </p>
                    <p className="mt-3 text-sm font-medium text-slate-700">
                      {count} в очереди
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
