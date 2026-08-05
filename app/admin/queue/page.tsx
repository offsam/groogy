import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Globe2, Inbox, type LucideIcon } from "lucide-react";
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
  ADMIN_LANE_HINTS,
  ADMIN_LANE_LABELS,
} from "@/lib/admin/lanes/types";
import { TELEGRAM_SOURCE_LIST } from "@/lib/import-review/telegram-sources";
import { DIRECTORY_SOURCE_LIST } from "@/lib/import-review/directory-sources";
import type {
  InboxViewId,
} from "@/lib/admin/inbox/types";
import {
  directorySourceInboxHref,
  importsInboxHref,
  telegramSourceInboxHref,
} from "@/lib/admin/imports/inbox-href";

export const metadata: Metadata = {
  title: "На обработку — Admin",
};

export const dynamic = "force-dynamic";

function formatCount(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(n);
}

/** Site favicon for a source homepage (or bare host). */
function faviconFor(homepageOrHost: string): string {
  try {
    const host = homepageOrHost.includes("://")
      ? new URL(homepageOrHost).hostname
      : homepageOrHost;
    const clean = host.replace(/^www\./, "");
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(clean)}&sz=64`;
  } catch {
    return `https://www.google.com/s2/favicons?domain=example.com&sz=64`;
  }
}

const TELEGRAM_ICON = faviconFor("telegram.org");
const FACEBOOK_ICON = faviconFor("facebook.com");
const LOVEOVERSE_ICON = faviconFor("loveoverse.com");
const EVENTBRITE_ICON = faviconFor("eventbrite.com");

type Tile = {
  href: string;
  title: string;
  description?: string;
  count?: number;
  primary?: boolean;
  icon?: LucideIcon;
  /** Prefer over Lucide — usually the source site favicon. */
  iconSrc?: string;
};

export default async function AdminQueueHubPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/admin/queue");
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

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          На обработку
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Сначала полоса (что делать), потом источник (откуда пришло).
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Разбор по полосам — сюда
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {ADMIN_LANE_IDS.map((id) => (
            <Link
              key={id}
              href={importsInboxHref({
                view: `lane_${id}` as InboxViewId,
              })}
              title={ADMIN_LANE_HINTS[id]}
              className="flex min-h-[5.5rem] flex-col rounded-xl border border-brand-blue/30 bg-white p-2.5 ring-1 ring-brand-blue/10 transition hover:border-brand-blue sm:p-3"
            >
              <span className="text-[11px] font-semibold text-brand-blue-deep sm:text-xs">
                {ADMIN_LANE_LABELS[id]}
              </span>
              <span className="mt-1 text-xl font-bold tabular-nums text-slate-900 sm:text-2xl">
                {formatCount(laneCounts[id] ?? 0)}
              </span>
              <span className="mt-1 line-clamp-2 text-[10px] leading-snug text-slate-500 sm:text-[11px]">
                {ADMIN_LANE_HINTS[id]}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Или вся лента / источник
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          <TileCard
            tile={{
              href: importsInboxHref(),
              title: "Вся лента",
              description: "Все вместе · сверху готовые · по 20",
              count: counts.feedPending,
              primary: true,
              icon: Inbox,
            }}
          />
          <TileCard
            tile={{
              href: importsInboxHref({ view: "telegram", source: "telegram" }),
              title: "Telegram · все",
              description: "Все группы",
              count: counts.telegramPending,
              iconSrc: TELEGRAM_ICON,
            }}
          />
          <TileCard
            tile={{
              href: importsInboxHref({
                view: "facebook",
                source: "facebook",
              }),
              title: "Facebook",
              description: "Из Facebook",
              count: counts.facebookPending,
              iconSrc: FACEBOOK_ICON,
            }}
          />
          <TileCard
            tile={{
              href: importsInboxHref({
                view: "directories",
                source: "directories",
              }),
              title: "Онлайн каталоги · все",
              description: "Все справочники",
              count: counts.yellowPagesPending,
              icon: Globe2,
            }}
          />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Telegram
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {TELEGRAM_SOURCE_LIST.map((source) => (
            <TileCard
              key={source.id}
              tile={{
                href: telegramSourceInboxHref(source.id),
                title: source.shortTitle,
                description: source.regionHint,
                count: counts.telegramPendingBySource[source.id] ?? 0,
                iconSrc: TELEGRAM_ICON,
              }}
            />
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Онлайн каталоги
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          <TileCard
            tile={{
              href: importsInboxHref({
                view: "loveoverse",
                source: "loveoverse",
              }),
              title: "Loveoverse",
              description: "Афиша LA · loveoverse.com",
              count: counts.loveoversePending,
              iconSrc: LOVEOVERSE_ICON,
            }}
          />
          <TileCard
            tile={{
              href: importsInboxHref({
                view: "eventbrite",
                source: "eventbrite",
              }),
              title: "Eventbrite",
              description: "Афиша CA · eventbrite.com",
              count: counts.eventbritePending,
              iconSrc: EVENTBRITE_ICON,
            }}
          />
          {DIRECTORY_SOURCE_LIST.map((source) => (
            <TileCard
              key={source.id}
              tile={{
                href: directorySourceInboxHref(source.id),
                title: source.shortTitle,
                description: source.regionHint,
                count: counts.directoryPendingBySource[source.id] ?? 0,
                iconSrc: faviconFor(source.homepage),
              }}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function TileCard({ tile }: { tile: Tile }) {
  const Icon = tile.icon ?? Inbox;
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
          className={`inline-flex size-7 items-center justify-center overflow-hidden rounded-md ${
            tile.primary
              ? "bg-brand-blue text-white"
              : tile.iconSrc
                ? "bg-white ring-1 ring-slate-200"
                : "bg-slate-100 text-slate-700"
          }`}
        >
          {tile.iconSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- external favicon hosts
            <img
              src={tile.iconSrc}
              alt=""
              width={16}
              height={16}
              className="size-4"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <Icon className="size-3.5" />
          )}
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
      <h3 className="mt-2 text-sm font-semibold leading-snug text-slate-900">
        {tile.title}
      </h3>
      {tile.description ? (
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500">
          {tile.description}
        </p>
      ) : null}
    </Link>
  );
}
