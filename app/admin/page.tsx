import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BarChart3,
  BookMarked,
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
import {
  getAdminDashboardCounts,
  type AdminDashboardCounts,
} from "@/lib/admin/queries";

export const metadata: Metadata = {
  title: "Панель управления — КРУГИ",
};

export const dynamic = "force-dynamic";

type LinkItem = {
  href: string;
  title: string;
  description: string;
  icon: typeof Inbox;
  countKey: keyof AdminDashboardCounts | null;
  countLabel: string;
};

const LINKS: LinkItem[] = [
  {
    href: "/admin/analytics",
    title: "Аналитика",
    description: "Посещения сайта, пользователи, рост каталога",
    icon: BarChart3,
    countKey: "pageViewsToday",
    countLabel: "просмотров сегодня",
  },
  {
    href: "/admin/claims",
    title: "Заявки на владение",
    description: "Одобрить или отклонить «Это мой бизнес»",
    icon: Shield,
    countKey: "claimsPending",
    countLabel: "в очереди",
  },
  {
    href: "/admin/import-review",
    title: "Импорт → Требуют проверки",
    description: "Очередь Telegram AI Reviewer перед публикацией",
    icon: Inbox,
    countKey: "importReviewPending",
    countLabel: "в очереди",
  },
  {
    href: "/admin/events",
    title: "События — верификация",
    description: "Эфиры и митапы из FB → публикация на /events",
    icon: Inbox,
    countKey: "eventsPending",
    countLabel: "в очереди",
  },
  {
    href: "/admin/recommendations",
    title: "Рекомендации из комментариев",
    description: "FB: «подскажите мастера» → контакты из комментариев",
    icon: MessageSquareWarning,
    countKey: "recommendationsPending",
    countLabel: "в очереди",
  },
  {
    href: "/admin/directories",
    title: "Справочники",
    description: "Внешние Yellow Pages / каталоги — по источникам",
    icon: BookMarked,
    countKey: "yellowPagesPending",
    countLabel: "карточек",
  },
  {
    href: "/admin/telegram-groups",
    title: "Telegram-группы",
    description: "Sacramento / SF / San Diego и др. — отдельный блок на группу",
    icon: MessageSquareWarning,
    countKey: "telegramPending",
    countLabel: "карточек",
  },
  {
    href: "/admin/businesses",
    title: "Бизнесы",
    description: "Одобрить, редактировать, удалить, смержить дубликаты",
    icon: Building2,
    countKey: "businessesPending",
    countLabel: "на проверке",
  },
  {
    href: "/admin/listings",
    title: "Объявления",
    description: "Модерация marketplace и жалоб",
    icon: ClipboardList,
    countKey: "listingReportsPending",
    countLabel: "жалоб",
  },
  {
    href: "/admin/reviews",
    title: "Отзывы",
    description: "Очередь модерации и верификации",
    icon: MessageSquareWarning,
    countKey: "reviewsPending",
    countLabel: "в очереди",
  },
  {
    href: "/admin/users",
    title: "Админы и пользователи",
    description: "Назначить или снять администраторов",
    icon: Users,
    countKey: "usersTotal",
    countLabel: "пользователей",
  },
  {
    href: "/admin/master-data",
    title: "Master Data",
    description: "Категории, языки, география",
    icon: Database,
    countKey: null,
    countLabel: "",
  },
];

function formatCount(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(n);
}

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

  let counts: AdminDashboardCounts = {
    businessesPending: 0,
    reviewsPending: 0,
    listingReportsPending: 0,
    usersTotal: 0,
    pageViewsToday: 0,
    claimsPending: 0,
    importReviewPending: 0,
    eventsPending: 0,
    recommendationsPending: 0,
    yellowPagesPending: 0,
    directoryPendingBySource: {},
    telegramPendingBySource: {},
    telegramPending: 0,
  };
  try {
    counts = await getAdminDashboardCounts(supabase);
  } catch {
    // Panel still usable if some counts fail
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
          const raw =
            item.countKey != null ? counts[item.countKey] : null;
          const count = typeof raw === "number" ? raw : null;
          const hasQueue = count != null;
          const busy = hasQueue && count > 0;

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
                {hasQueue ? (
                  <span
                    className={`rounded-md px-2.5 py-1 text-right ${
                      busy
                        ? "bg-brand-orange/15 text-orange-900"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    <span className="block text-lg font-bold leading-none tabular-nums">
                      {formatCount(count)}
                    </span>
                    <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-wide opacity-80">
                      {item.countLabel}
                    </span>
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
