import Link from "next/link";
import { MessageCircle } from "lucide-react";
import {
  TELEGRAM_SOURCE_LIST,
  TELEGRAM_CA_CITY_SOURCE_IDS,
} from "@/lib/import-review/telegram-sources";
import { createServerClient } from "@/lib/supabase/server";
import { getTelegramSourceStats } from "@/lib/admin/imports/stats";
import {
  importsInboxHref,
  telegramSourceInboxHref,
} from "@/lib/admin/imports/inbox-href";
import { IMPORT_STATUS_LABELS } from "@/lib/admin/imports/types";
import { LegacyMigrationBanner } from "@/components/admin/LegacyMigrationBanner";

type Props = {
  /** e.g. `/admin/imports/telegram` or `/admin/telegram-groups` */
  basePath: string;
  showLegacyBanner?: boolean;
};

function SourceCard({
  source,
  stats,
  accent,
  basePath,
}: {
  source: (typeof TELEGRAM_SOURCE_LIST)[number];
  stats: Awaited<ReturnType<typeof getTelegramSourceStats>> | null;
  accent: "blue" | "slate";
  basePath: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 rounded-lg p-2 ${
            accent === "blue"
              ? "bg-brand-blue/10 text-brand-blue"
              : "bg-slate-100 text-slate-700"
          }`}
        >
          <MessageCircle className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-slate-900">{source.title}</h3>
          <p className="mt-1 text-sm text-slate-500">{source.description}</p>
          <p className="mt-3 text-xs text-slate-600">
            {stats
              ? `${IMPORT_STATUS_LABELS[stats.importStatus]} · Imported ${stats.imported} · In Review ${stats.inReview} · Approved ${stats.approved}`
              : "Статистика недоступна"}
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <Link
              href={`${basePath}/${source.slug}`}
              className="font-medium text-slate-800 hover:underline"
            >
              История
            </Link>
            <Link
              href={telegramSourceInboxHref(source.id)}
              className="font-medium text-brand-blue hover:underline"
            >
              Open in Inbox →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export async function TelegramImportsIndex({
  basePath,
  showLegacyBanner = false,
}: Props) {
  const supabase = await createServerClient();

  const citySources = TELEGRAM_SOURCE_LIST.filter((s) =>
    TELEGRAM_CA_CITY_SOURCE_IDS.includes(s.id),
  );
  const otherSources = TELEGRAM_SOURCE_LIST.filter(
    (s) => !TELEGRAM_CA_CITY_SOURCE_IDS.includes(s.id),
  );

  const statsEntries = await Promise.all(
    TELEGRAM_SOURCE_LIST.map(async (source) => {
      const stats = await getTelegramSourceStats(supabase, source.id).catch(
        () => null,
      );
      return [source.id, stats] as const;
    }),
  );
  const statsById = Object.fromEntries(statsEntries);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {showLegacyBanner ? (
        <LegacyMigrationBanner migrationId="telegram-groups" />
      ) : null}
      <div>
        <p className="text-sm font-medium text-brand-blue">
          Imports · Telegram · History
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          Telegram
        </h1>
        <p className="mt-2 max-w-2xl text-slate-500">
          История групп. Модерация — в Очереди.
        </p>
        <p className="mt-3 flex flex-wrap gap-4 text-sm">
          <Link
            href={importsInboxHref({
              view: "recently_imported",
              source: "telegram",
            })}
            className="font-medium text-brand-green hover:underline"
          >
            Свежие в Inbox →
          </Link>
          <Link
            href={importsInboxHref({ view: "telegram", source: "telegram" })}
            className="font-medium text-brand-blue hover:underline"
          >
            Все Telegram в Inbox →
          </Link>
          <Link href="/admin/imports" className="text-brand-blue hover:underline">
            ← Imports
          </Link>
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">
          California
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {citySources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              stats={statsById[source.id] ?? null}
              accent="blue"
              basePath={basePath}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">
          США · другие города
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {otherSources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              stats={statsById[source.id] ?? null}
              accent="slate"
              basePath={basePath}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
