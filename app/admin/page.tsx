import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ADMIN_SECTIONS } from "@/lib/admin/sections";
import {
  getAdminDashboardCounts,
  getAdminAnalytics,
  type AdminDashboardCounts,
} from "@/lib/admin/queries";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Админка — КРУГИ",
};

export const dynamic = "force-dynamic";

function formatInt(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n));
}

async function countSearches7d(
  client: Awaited<ReturnType<typeof createServerClient>>,
): Promise<number> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count } = await client
    .from("platform_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "search")
    .gte("created_at", since);
  return count ?? 0;
}

export default async function AdminPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin");
  if (!(await userIsAdmin(supabase))) redirect("/");

  let counts: AdminDashboardCounts | null = null;
  let analytics: AdminAnalytics | null = null;
  let searches7d = 0;
  try {
    [counts, analytics, searches7d] = await Promise.all([
      getAdminDashboardCounts(supabase),
      getAdminAnalytics(supabase),
      countSearches7d(supabase),
    ]);
  } catch {
    counts = null;
  }

  const stats = [
    {
      label: "Пользователи",
      value: formatInt(analytics?.users_total ?? counts?.usersTotal ?? 0),
      hint: `+${formatInt(analytics?.users_today ?? 0)} новых сегодня`,
    },
    {
      label: "Бизнесы",
      value: formatInt(analytics?.businesses_approved ?? 0),
      hint: `+${formatInt(analytics?.businesses_today ?? 0)} новых сегодня`,
    },
    {
      label: "Запросы",
      value: formatInt(searches7d),
      hint: "поисков за 7 дней",
    },
    {
      label: "Контакты",
      value: formatInt(analytics?.contact_reveals_7d ?? 0),
      hint: "открытий за 7 дней",
    },
    {
      label: "Очередь",
      value: formatInt(counts?.feedPending ?? 0),
      hint: "карточек на обработке",
    },
    {
      label: "Ошибки",
      value: formatInt(counts?.errorsOpen ?? 0),
      hint: "открытых сообщений",
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          Админка
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Сначала цифры, ниже пять разделов.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-slate-200 bg-white p-3"
          >
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {stat.label}
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
              {stat.value}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">{stat.hint}</p>
          </div>
        ))}
      </div>

      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ADMIN_SECTIONS.map((section) => (
          <li key={section.id}>
            <Link
              className="flex min-h-11 flex-col rounded-xl border border-slate-200 bg-white p-4 hover:border-brand-blue/40"
              href={section.href}
            >
              <span className="text-base font-semibold text-slate-900">
                {section.label}
              </span>
              <span className="mt-1 text-sm text-slate-500">
                {section.description}
              </span>
              <span className="mt-3 text-xs text-slate-400">
                {section.links.length} внутри
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
