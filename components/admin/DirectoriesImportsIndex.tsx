import Link from "next/link";
import { BookMarked } from "lucide-react";
import { DIRECTORY_SOURCE_LIST } from "@/lib/import-review/directory-sources";
import { createServerClient } from "@/lib/supabase/server";
import { getDirectorySourceStats } from "@/lib/admin/imports/stats";
import {
  directorySourceInboxHref,
  importsInboxHref,
} from "@/lib/admin/imports/inbox-href";
import { IMPORT_STATUS_LABELS } from "@/lib/admin/imports/types";
import { LegacyMigrationBanner } from "@/components/admin/LegacyMigrationBanner";

type Props = {
  /** e.g. `/admin/imports/directories` or `/admin/directories` */
  basePath: string;
  showLegacyBanner?: boolean;
};

export async function DirectoriesImportsIndex({
  basePath,
  showLegacyBanner = false,
}: Props) {
  const supabase = await createServerClient();

  const statsEntries = await Promise.all(
    DIRECTORY_SOURCE_LIST.map(async (source) => {
      const stats = await getDirectorySourceStats(supabase, source.id).catch(
        () => null,
      );
      return [source.id, stats] as const;
    }),
  );
  const statsById = Object.fromEntries(statsEntries);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {showLegacyBanner ? (
        <LegacyMigrationBanner migrationId="directories" />
      ) : null}
      <div>
        <p className="text-sm font-medium text-amber-800">
          Imports · Directories · History
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          Directories
        </h1>
        <p className="mt-2 max-w-2xl text-slate-500">
          Provenance внешних справочников. Модерация — только в Review Center
          Inbox.
        </p>
        <p className="mt-3 flex flex-wrap gap-4 text-sm">
          <Link
            href={importsInboxHref({
              source: "directories",
              reviewType: "recommendation",
            })}
            className="font-medium text-brand-blue hover:underline"
          >
            Open Directories in Inbox →
          </Link>
          <Link href="/admin/imports" className="text-brand-blue hover:underline">
            ← Imports
          </Link>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DIRECTORY_SOURCE_LIST.map((source) => {
          const stats = statsById[source.id];
          return (
            <div
              key={source.id}
              className="rounded-2xl border border-slate-200 bg-white p-5"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 rounded-lg bg-brand-yellow/20 p-2 text-amber-900">
                  <BookMarked className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-slate-900">{source.title}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {source.description}
                  </p>
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
                    {source.id === "to4ka" ? (
                      <Link
                        href="/admin/to4ka-enrich"
                        className="font-medium text-brand-blue hover:underline"
                      >
                        Прогресс обогащения →
                      </Link>
                    ) : null}
                    <Link
                      href={directorySourceInboxHref(source.id)}
                      className="font-medium text-brand-blue hover:underline"
                    >
                      Open in Inbox →
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
