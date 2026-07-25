import Link from "next/link";
import {
  BriefcaseBusiness,
  CalendarDays,
  MessageSquareText,
  Store,
  Tags,
  Users,
} from "lucide-react";
import type { PlatformResourceStats } from "@/lib/platform/resource-stats";

type HomeStatsProps = {
  stats: PlatformResourceStats | null;
};

function formatCount(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(n);
}

export function HomeStats({ stats }: HomeStatsProps) {
  const items = [
    {
      label: "Бизнесы",
      value: stats?.businesses ?? 0,
      delta: stats?.addedToday ?? 0,
      href: "/search",
      icon: Store,
    },
    {
      label: "Предложения",
      value: stats?.offers ?? 0,
      delta: 0,
      href: "/search",
      icon: Tags,
    },
    {
      label: "Объявления",
      value: stats?.listings ?? 0,
      delta: 0,
      href: "/marketplace",
      icon: BriefcaseBusiness,
    },
    {
      label: "Всего ресурсов",
      value: stats?.total ?? 0,
      delta: stats?.addedToday ?? 0,
      href: "/search",
      icon: Users,
    },
    {
      label: "Обновлено",
      value: stats?.updatedToday ?? 0,
      delta: 0,
      href: "/search",
      icon: CalendarDays,
    },
    {
      label: "За вчера",
      value: stats?.addedYesterday ?? 0,
      delta: 0,
      href: "/search",
      icon: MessageSquareText,
    },
  ];

  return (
    <section className="w-full border-b border-slate-200 bg-white">
      <div className="mx-auto grid max-w-[1400px] grid-cols-2 gap-px bg-slate-200 sm:grid-cols-3 lg:grid-cols-6">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              className="flex flex-col gap-2 bg-white px-4 py-4 transition hover:bg-slate-50 sm:px-5"
              href={item.href}
            >
              <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
                <Icon aria-hidden className="size-3.5" />
                {item.label}
              </span>
              <span className="text-2xl font-semibold tabular-nums text-slate-900">
                {formatCount(item.value)}
              </span>
              {item.delta > 0 ? (
                <span className="text-xs font-medium text-emerald-600">
                  +{formatCount(item.delta)} сегодня
                </span>
              ) : (
                <span className="text-xs text-slate-400">актуально</span>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
