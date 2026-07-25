import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BarChart3,
  Building2,
  ClipboardList,
  Database,
  Inbox,
  MessageSquareWarning,
  Shield,
  Users,
} from "lucide-react";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import { getAdminDashboardCounts } from "@/lib/admin/queries";

export const metadata: Metadata = {
  title: "Панель управления — КРУГИ",
};

const LINKS = [
  {
    href: "/admin/analytics",
    title: "Аналитика",
    description: "Посещения сайта, пользователи, рост каталога",
    icon: BarChart3,
    countKey: "pageViewsToday" as const,
    countLabel: "просмотров сегодня",
  },
  {
    href: "/admin/claims",
    title: "Заявки на владение",
    description: "Одобрить или отклонить «Это мой бизнес»",
    icon: Shield,
    countKey: null,
    countLabel: null,
  },
  {
    href: "/admin/import-review",
    title: "Импорт → Требуют проверки",
    description: "Очередь Telegram AI Reviewer перед публикацией",
    icon: Inbox,
    countKey: null,
    countLabel: null,
  },
  {
    href: "/admin/businesses",
    title: "Бизнесы",
    description: "Одобрить, редактировать, удалить, смержить дубликаты",
    icon: Building2,
    countKey: "businessesPending" as const,
    countLabel: "на проверке",
  },
  {
    href: "/admin/listings",
    title: "Объявления",
    description: "Модерация marketplace и жалоб",
    icon: ClipboardList,
    countKey: "listingReportsPending" as const,
    countLabel: "жалоб",
  },
  {
    href: "/admin/reviews",
    title: "Отзывы",
    description: "Очередь модерации и верификации",
    icon: MessageSquareWarning,
    countKey: "reviewsPending" as const,
    countLabel: "в очереди",
  },
  {
    href: "/admin/users",
    title: "Админы и пользователи",
    description: "Назначить или снять администраторов",
    icon: Users,
    countKey: "usersTotal" as const,
    countLabel: "пользователей",
  },
  {
    href: "/admin/master-data",
    title: "Master Data",
    description: "Категории, языки, география",
    icon: Database,
    countKey: null,
    countLabel: null,
  },
];

export default async function AdminPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin");
  }

  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    redirect("/");
  }

  let counts = {
    businessesPending: 0,
    reviewsPending: 0,
    listingReportsPending: 0,
    usersTotal: 0,
    pageViewsToday: 0,
  };
  try {
    counts = await getAdminDashboardCounts(supabase);
  } catch {
    // Panel still usable if analytics RPC fails
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-medium text-brand-blue-deep">
            <Shield className="size-4" />
            Панель управления
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
            Админ-панель
          </h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Публичный сайт остаётся как есть. Здесь — отдельные инструменты:
            проверка карточек, объявления, отзывы, аналитика и управление
            админами.
          </p>
        </div>
        <Link
          className="inline-flex rounded-lg border border-slate-900 bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
          href="/admin/businesses/new"
        >
          + Добавить бизнес
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {LINKS.map((item) => {
          const Icon = item.icon;
          const count =
            item.countKey != null ? counts[item.countKey] : null;
          return (
            <Link
              key={item.href}
              className="group rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-slate-400"
              href={item.href}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="inline-flex rounded-lg bg-slate-100 p-2 text-slate-700 group-hover:bg-slate-900 group-hover:text-white">
                  <Icon className="size-5" />
                </span>
                {count != null ? (
                  <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                    {count} {item.countLabel}
                  </span>
                ) : null}
              </div>
              <h2 className="mt-4 text-lg font-semibold text-slate-900">
                {item.title}
              </h2>
              <p className="mt-1 text-sm text-slate-500">{item.description}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
