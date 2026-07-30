import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import {
  BarChart3,
  BookMarked,
  Briefcase,
  Building2,
  CalendarDays,
  ClipboardList,
  Database,
  FolderInput,
  Inbox,
  LayoutGrid,
  MessageSquareWarning,
  Shield,
  UserRound,
  Users,
} from "lucide-react";
import { DashboardAssignedToMe } from "@/components/admin/DashboardAssignedToMe";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import {
  getAdminDashboardCounts,
  type AdminDashboardCounts,
} from "@/lib/admin/queries";

export const metadata: Metadata = {
  title: "Dashboard — Admin — КРУГИ",
};

export const dynamic = "force-dynamic";

function formatCount(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(n);
}

type Kpi = {
  label: string;
  value: string;
  href: string;
  hint: string;
};

type NavCard = {
  href: string;
  title: string;
  description: string;
  icon: typeof Inbox;
  count?: number | null;
  countLabel?: string;
};

type QuickAction =
  | { kind: "link"; href: string; label: string }
  | { kind: "soon"; label: string };

const QUICK_ACTIONS: QuickAction[] = [
  { kind: "link", href: "/admin/review/inbox", label: "Open Inbox" },
  {
    kind: "link",
    href: "/admin/review/inbox?view=high_confidence",
    label: "High Confidence",
  },
  {
    kind: "link",
    href: "/admin/review/inbox?view=claims",
    label: "Claims",
  },
  {
    kind: "link",
    href: "/admin/review/inbox?view=events",
    label: "Events",
  },
  {
    kind: "link",
    href: "/admin/review/inbox?view=recommendations",
    label: "Recommendations",
  },
  {
    kind: "link",
    href: "/admin/catalog/businesses",
    label: "Catalog · Businesses",
  },
  {
    kind: "link",
    href: "/admin/imports/telegram",
    label: "Imports · Telegram",
  },
  { kind: "soon", label: "Add business" },
  { kind: "soon", label: "Settings" },
];

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </h2>
  );
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
    // Dashboard still usable if some counts fail
  }

  const pendingTasks =
    counts.importReviewPending +
    counts.claimsPending +
    counts.eventsPending +
    counts.recommendationsPending;

  const kpis: Kpi[] = [
    {
      label: "Pending Tasks",
      value: formatCount(pendingTasks),
      href: "/admin/review/inbox",
      hint: "Import + Claims + Events + Recommendations",
    },
    {
      label: "Import Review",
      value: formatCount(counts.importReviewPending),
      href: "/admin/review/inbox",
      hint: "Inbox · All",
    },
    {
      label: "Claims",
      value: formatCount(counts.claimsPending),
      href: "/admin/review/inbox?view=claims",
      hint: "Inbox · Claims",
    },
    {
      label: "Events",
      value: formatCount(counts.eventsPending),
      href: "/admin/review/inbox?view=events",
      hint: "Inbox · Events",
    },
    {
      label: "Recommendations",
      value: formatCount(counts.recommendationsPending),
      href: "/admin/review/inbox?view=recommendations",
      hint: "Inbox · Recommendations",
    },
    {
      label: "Page views today",
      value: formatCount(counts.pageViewsToday),
      href: "/admin/analytics",
      hint: "Analytics",
    },
  ];

  const reviewCards: NavCard[] = [
    {
      href: "/admin/review/inbox",
      title: "Inbox",
      description: "Единая очередь модерации → Workspace",
      icon: Inbox,
      count: pendingTasks,
      countLabel: "pending",
    },
    {
      href: "/admin/review/views",
      title: "Saved Views",
      description: "Пресеты фильтров Inbox",
      icon: LayoutGrid,
    },
  ];

  const catalogCards: NavCard[] = [
    {
      href: "/admin/catalog/businesses",
      title: "Businesses",
      description: "Опубликованные бизнесы",
      icon: Building2,
      count: counts.businessesPending,
      countLabel: "на проверке",
    },
    {
      href: "/admin/catalog/professionals",
      title: "Professionals",
      description: "Каталог специалистов",
      icon: UserRound,
    },
    {
      href: "/admin/catalog/marketplace",
      title: "Marketplace",
      description: "Объявления marketplace",
      icon: ClipboardList,
      count: counts.listingReportsPending,
      countLabel: "жалоб (KPI)",
    },
    {
      href: "/admin/catalog/jobs",
      title: "Jobs",
      description: "Вакансии",
      icon: Briefcase,
    },
    {
      href: "/admin/catalog/events",
      title: "Events",
      description: "Опубликованные события",
      icon: CalendarDays,
    },
  ];

  const importCards: NavCard[] = [
    {
      href: "/admin/imports/telegram",
      title: "Telegram",
      description: "История и диагностика групп",
      icon: MessageSquareWarning,
      count: counts.telegramPending,
      countLabel: "in review",
    },
    {
      href: "/admin/imports/directories",
      title: "Directories",
      description: "Справочники / Yellow Pages",
      icon: BookMarked,
      count: counts.yellowPagesPending,
      countLabel: "in review",
    },
    {
      href: "/admin/imports/facebook",
      title: "Facebook",
      description: "История источников Facebook",
      icon: FolderInput,
    },
    {
      href: "/admin/imports/csv",
      title: "CSV",
      description: "CSV / one-off импорты",
      icon: FolderInput,
    },
  ];

  const otherCards: NavCard[] = [
    {
      href: "/admin/community/reviews",
      title: "Community · Reviews",
      description: "Модерация отзывов",
      icon: MessageSquareWarning,
      count: counts.reviewsPending,
      countLabel: "в очереди",
    },
    {
      href: "/admin/community/reports",
      title: "Community · Reports",
      description: "Жалобы и репорты",
      icon: ClipboardList,
    },
    {
      href: "/admin/users",
      title: "Users",
      description: "Пользователи и роли",
      icon: Users,
      count: counts.usersTotal,
      countLabel: "пользователей",
    },
    {
      href: "/admin/analytics",
      title: "Analytics",
      description: "Посещения и рост каталога",
      icon: BarChart3,
      count: counts.pageViewsToday,
      countLabel: "сегодня",
    },
    {
      href: "/admin/system/taxonomy",
      title: "System · Taxonomy",
      description: "Категории, языки, география",
      icon: Database,
    },
  ];

  return (
    <div className="space-y-5 sm:space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-medium text-brand-blue-deep sm:text-sm">
            <Shield className="size-3.5 sm:size-4" />
            Dashboard
          </p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 sm:mt-2 sm:text-3xl">
            Admin Panel
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600 sm:mt-2 sm:text-base">
            Точка входа IA V2. Модерация — только через Inbox → Workspace.
            Legacy-очереди с Dashboard недоступны.
          </p>
        </div>
        <Link
          className="inline-flex rounded-lg bg-brand-blue px-3 py-2 text-sm font-medium text-white hover:bg-brand-blue-deep sm:px-4 sm:py-2.5"
          href="/admin/review/inbox"
        >
          Open Inbox
        </Link>
      </div>

      {/* KPI */}
      <section className="space-y-2 sm:space-y-3">
        <SectionTitle>KPI</SectionTitle>
        <div className="grid grid-cols-2 gap-1.5 sm:gap-2 lg:grid-cols-3 xl:grid-cols-6">
          {kpis.map((kpi) => (
            <Link
              key={kpi.label}
              href={kpi.href}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 transition hover:border-slate-400 sm:rounded-xl sm:px-3 sm:py-3"
            >
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 sm:text-[11px]">
                {kpi.label}
              </p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900 sm:mt-1 sm:text-2xl">
                {kpi.value}
              </p>
              <p className="mt-0.5 truncate text-[10px] text-slate-400 sm:mt-1 sm:text-xs">
                {kpi.hint}
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* Quick Actions */}
      <section className="space-y-2 sm:space-y-3">
        <SectionTitle>Quick Actions</SectionTitle>
        <div className="flex flex-wrap gap-1.5 sm:gap-2">
          {QUICK_ACTIONS.map((action) =>
            action.kind === "link" ? (
              <Link
                key={action.label}
                href={action.href}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 sm:rounded-lg sm:px-3 sm:py-2 sm:text-sm"
              >
                {action.label}
              </Link>
            ) : (
              <button
                key={action.label}
                type="button"
                disabled
                title="Coming Soon"
                className="cursor-not-allowed rounded-md border border-dashed border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-400 sm:rounded-lg sm:px-3 sm:py-2 sm:text-sm"
              >
                {action.label}
                <span className="ml-1.5 text-[10px] uppercase tracking-wide">
                  Soon
                </span>
              </button>
            ),
          )}
        </div>
      </section>

      {/* Widgets */}
      <section className="space-y-2 sm:space-y-3">
        <SectionTitle>Widgets</SectionTitle>
        <div className="grid grid-cols-2 gap-1.5 sm:gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            href="/admin/review/inbox"
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 transition hover:border-slate-400 sm:rounded-xl sm:px-4 sm:py-3"
          >
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 sm:text-[11px]">
              Pending Tasks
            </p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900 sm:mt-1 sm:text-2xl">
              {formatCount(pendingTasks)}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-500 sm:mt-1 sm:text-xs">
              Working · → Inbox
            </p>
          </Link>

          <Link
            href="/admin/review/inbox?view=high_confidence"
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 transition hover:border-slate-400 sm:rounded-xl sm:px-4 sm:py-3"
          >
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 sm:text-[11px]">
              High Priority / Confidence
            </p>
            <p className="mt-0.5 text-lg font-semibold text-slate-900 sm:mt-1 sm:text-2xl">
              Open
            </p>
            <p className="mt-0.5 text-[10px] text-slate-500 sm:mt-1 sm:text-xs">
              Working · Inbox view (счётчик в Inbox)
            </p>
          </Link>

          <DashboardAssignedToMe userId={user.id} />

          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2.5 py-2 sm:rounded-xl sm:px-4 sm:py-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 sm:text-[11px]">
              Recent Imports
            </p>
            <p className="mt-0.5 text-xs font-medium text-slate-700 sm:mt-1 sm:text-sm">
              Placeholder
            </p>
            <p className="mt-0.5 text-[10px] text-slate-500 sm:mt-1 sm:text-xs">
              Нет отдельного feed API · смотрите{" "}
              <Link
                href="/admin/imports"
                className="text-brand-blue hover:underline"
              >
                Imports
              </Link>
            </p>
          </div>

          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2.5 py-2 sm:rounded-xl sm:px-4 sm:py-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 sm:text-[11px]">
              Recent Reviews
            </p>
            <p className="mt-0.5 text-xs font-medium text-slate-700 sm:mt-1 sm:text-sm">
              Placeholder
            </p>
            <p className="mt-0.5 text-[10px] text-slate-500 sm:mt-1 sm:text-xs">
              KPI отзывов:{" "}
              <Link
                href="/admin/community/reviews"
                className="text-brand-blue hover:underline"
              >
                Community · Reviews
              </Link>{" "}
              ({formatCount(counts.reviewsPending)} pending)
            </p>
          </div>

          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2.5 py-2 sm:rounded-xl sm:px-4 sm:py-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 sm:text-[11px]">
              System Health
            </p>
            <p className="mt-0.5 text-xs font-medium text-slate-700 sm:mt-1 sm:text-sm">
              Coming Soon
            </p>
            <p className="mt-0.5 text-[10px] text-slate-500 sm:mt-1 sm:text-xs">
              Нет health-сервиса · без нового backend
            </p>
          </div>
        </div>
      </section>

      {/* Navigation sections */}
      <DashboardCardGrid title="Review Center" cards={reviewCards} />
      <DashboardCardGrid title="Catalog" cards={catalogCards} />
      <DashboardCardGrid title="Imports" cards={importCards} />
      <DashboardCardGrid title="More" cards={otherCards} />
    </div>
  );
}

function DashboardCardGrid({
  title,
  cards,
}: {
  title: string;
  cards: NavCard[];
}) {
  return (
    <section className="space-y-2 sm:space-y-3">
      <SectionTitle>{title}</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5 sm:gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((item) => {
          const Icon = item.icon;
          const count = item.count;
          const hasQueue = typeof count === "number";
          const busy = hasQueue && count > 0;
          return (
            <Link
              key={item.href + item.title}
              className="group rounded-lg border border-slate-200 bg-white p-2.5 transition-colors hover:border-slate-400 sm:rounded-xl sm:p-5"
              href={item.href}
            >
              <div className="flex items-start justify-between gap-2 sm:gap-3">
                <span className="inline-flex rounded-md bg-slate-100 p-1.5 text-slate-700 group-hover:bg-slate-900 group-hover:text-white sm:rounded-lg sm:p-2">
                  <Icon className="size-3.5 sm:size-5" />
                </span>
                {hasQueue ? (
                  <span
                    className={`rounded px-1.5 py-0.5 text-right sm:rounded-md sm:px-2.5 sm:py-1 ${
                      busy
                        ? "bg-brand-orange/15 text-orange-900"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    <span className="block text-sm font-bold leading-none tabular-nums sm:text-lg">
                      {formatCount(count)}
                    </span>
                    {item.countLabel ? (
                      <span className="mt-0.5 block text-[9px] font-medium uppercase tracking-wide opacity-80 sm:text-[10px]">
                        {item.countLabel}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </div>
              <h3 className="mt-2 text-sm font-semibold text-slate-900 sm:mt-4 sm:text-lg">
                {item.title}
              </h3>
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500 sm:mt-1 sm:text-sm sm:leading-normal">
                {item.description}
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
