import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Building2,
  ClipboardCheck,
  Inbox,
  MessageSquare,
  Phone,
  Sparkles,
  Tags,
  Users,
  Library,
} from "lucide-react";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import {
  getAdminDashboardCounts,
  type AdminDashboardCounts,
} from "@/lib/admin/queries";
import {
  getAdminLaneCounts,
  EMPTY_LANE_COUNTS,
  type AdminLaneCounts,
} from "@/lib/admin/lanes/counts";
import {
  ADMIN_LANE_IDS,
  ADMIN_LANE_LABELS,
} from "@/lib/admin/lanes/types";

export const metadata: Metadata = {
  title: "Админка — КРУГИ",
};

export const dynamic = "force-dynamic";

function formatCount(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(n);
}

type Tile = {
  href: string;
  title: string;
  description: string;
  count?: number;
  primary?: boolean;
  icon: typeof Inbox;
};

export default async function AdminPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/admin");
  if (!(await userIsAdmin(supabase))) redirect("/");

  let counts: AdminDashboardCounts = {
    businessesPending: 0,
    reviewsPending: 0,
    listingReportsPending: 0,
    usersTotal: 0,
    pageViewsToday: 0,
    contactRevealsTotal: 0,
    claimsPending: 0,
    importReviewPending: 0,
    eventsPending: 0,
    recommendationsPending: 0,
    yellowPagesPending: 0,
    facebookPending: 0,
    loveoversePending: 0,
    eventbritePending: 0,
    errorsOpen: 0,
    feedPending: 0,
    directoryPendingBySource: {},
    telegramPendingBySource: {},
    telegramPending: 0,
  };
  let laneCounts: AdminLaneCounts = EMPTY_LANE_COUNTS;
  try {
    counts = await getAdminDashboardCounts(supabase);
  } catch {
    // still render
  }
  try {
    laneCounts = await getAdminLaneCounts(supabase);
  } catch {
    // still render
  }

  const tiles: Tile[] = [
    {
      href: "/admin/queue",
      title: "На обработку",
      description: "Полосы: прикрепить / разложить / готово / помойка",
      count: counts.feedPending,
      primary: true,
      icon: Inbox,
    },
    {
      href: "/admin/analytics",
      title: "Активность",
      description: "Трафик, контакты, рост",
      count: counts.pageViewsToday,
      icon: Activity,
    },
    {
      href: "/admin/contact-reveals",
      title: "Открытия контактов",
      description: "Кто кликает «Показать»",
      count: counts.contactRevealsTotal,
      icon: Phone,
    },
    {
      href: "/admin/claims",
      title: "Верификация",
      description: "Владение карточками",
      count: counts.claimsPending,
      icon: ClipboardCheck,
    },
    {
      href: "/admin/users",
      title: "Пользователи",
      description: "Аккаунты и роли",
      count: counts.usersTotal,
      icon: Users,
    },
    {
      href: "/admin/system/error-reports",
      title: "Ошибки",
      description: "С сайта",
      count: counts.errorsOpen,
      icon: AlertTriangle,
    },
    {
      href: "/admin/community/reviews",
      title: "Отзывы",
      description: "Модерация",
      count: counts.reviewsPending,
      icon: MessageSquare,
    },
    {
      href: "/admin/catalog",
      title: "Каталог",
      description: "По штату / округу / категории",
      icon: Building2,
    },
    {
      href: "/admin/resources",
      title: "Ресурсы",
      description: "Telegram, Facebook, каталоги — откуда парсим",
      icon: Library,
    },
    {
      href: "/admin/to4ka-enrich",
      title: "Обогащение to4ka",
      description: "Прогресс массового прогона · N/M %",
      primary: true,
      icon: Sparkles,
    },
    {
      href: "/admin/system/taxonomy",
      title: "Категории",
      description: "Таксономия",
      icon: Tags,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          Админка
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Разбор потока по полосам → каталог. Не выбрасываем пользу — помойка
          это карантин.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {ADMIN_LANE_IDS.map((id) => (
          <Link
            key={id}
            href={`/admin/review/inbox?view=lane_${id}`}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 transition hover:border-brand-blue/40"
          >
            <div className="text-xs font-medium text-slate-500">
              {ADMIN_LANE_LABELS[id]}
            </div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
              {formatCount(laneCounts[id] ?? 0)}
            </div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {tiles.map((tile) => (
          <TileCard key={tile.href} tile={tile} />
        ))}
      </div>
    </div>
  );
}

function TileCard({ tile }: { tile: Tile }) {
  const Icon = tile.icon;
  const busy = typeof tile.count === "number" && tile.count > 0;
  return (
    <Link
      href={tile.href}
      title={tile.description}
      className={`flex min-h-[5.5rem] flex-col rounded-xl border bg-white p-2.5 transition hover:border-slate-400 sm:p-3 ${
        tile.primary
          ? "border-brand-blue/40 ring-1 ring-brand-blue/15"
          : "border-slate-200"
      }`}
    >
      <div className="flex items-start justify-between gap-1.5">
        <span
          className={`inline-flex rounded-md p-1.5 ${
            tile.primary
              ? "bg-brand-blue text-white"
              : "bg-slate-100 text-slate-700"
          }`}
        >
          <Icon className="size-3.5" />
        </span>
        {typeof tile.count === "number" ? (
          <span
            className={`rounded px-1.5 py-0.5 text-xs font-bold tabular-nums leading-none ${
              busy
                ? "bg-brand-orange/15 text-orange-900"
                : "bg-slate-100 text-slate-500"
            }`}
          >
            {formatCount(tile.count)}
          </span>
        ) : null}
      </div>
      <h2 className="mt-2 text-sm font-semibold leading-snug text-slate-900">
        {tile.title}
      </h2>
      <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500">
        {tile.description}
      </p>
    </Link>
  );
}
