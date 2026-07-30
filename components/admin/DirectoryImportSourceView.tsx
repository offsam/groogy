import Link from "next/link";
import { notFound } from "next/navigation";
import { DirectorySourcePanel } from "@/components/admin/DirectorySourcePanel";
import { LegacyMigrationBanner } from "@/components/admin/LegacyMigrationBanner";
import {
  directorySourceBySlug,
  DIRECTORY_SOURCE_LIST,
} from "@/lib/import-review/directory-sources";
import { listCommentRecommendations } from "@/lib/import-review/recommendation-queries";
import { createServerClient } from "@/lib/supabase/server";
import { getDirectorySourceStats } from "@/lib/admin/imports/stats";
import { directorySourceInboxHref } from "@/lib/admin/imports/inbox-href";
import { emptyImportSourceStats } from "@/lib/admin/imports/types";

type Props = {
  slug: string;
  page: number;
  basePath: string;
  showLegacyBanner?: boolean;
};

export async function DirectoryImportSourceView({
  slug,
  page,
  basePath,
  showLegacyBanner = false,
}: Props) {
  const source = directorySourceBySlug(slug);
  if (!source) notFound();

  const supabase = await createServerClient();

  let items: Awaited<ReturnType<typeof listCommentRecommendations>>["items"] =
    [];
  let total = 0;
  let loadError: string | null = null;
  let stats = emptyImportSourceStats();

  try {
    const [listed, sourceStats] = await Promise.all([
      listCommentRecommendations(supabase, {
        status: "all",
        kind: "profi",
        bucket: "yellow_pages",
        directorySource: source.id,
        page,
        pageSize: 50,
      }),
      getDirectorySourceStats(supabase, source.id),
    ]);
    items = listed.items;
    total = listed.total;
    stats = sourceStats;
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : null;
    loadError =
      message?.trim() ||
      `Не удалось загрузить историю ${source.shortTitle}`;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {showLegacyBanner ? (
        <LegacyMigrationBanner migrationId="directories" />
      ) : null}
      <div>
        <p className="text-sm font-medium text-amber-800">
          Imports · Directories · History
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          {source.title}
        </h1>
        <p className="mt-2 max-w-3xl text-slate-500">{source.description}</p>
        <p className="mt-3 flex flex-wrap gap-4 text-sm">
          <Link href={basePath} className="text-brand-blue hover:underline">
            ← Все справочники
          </Link>
          <Link
            href={directorySourceInboxHref(source.id)}
            className="font-medium text-brand-blue hover:underline"
          >
            Open in Inbox →
          </Link>
          <a
            href={source.homepage}
            target="_blank"
            rel="noreferrer"
            className="text-brand-blue hover:underline"
          >
            Сайт-источник →
          </a>
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {DIRECTORY_SOURCE_LIST.map((s) => (
            <Link
              key={s.id}
              href={`${basePath}/${s.slug}`}
              className={
                s.id === source.id
                  ? "rounded-md bg-brand-blue px-2.5 py-1 text-xs font-semibold text-white"
                  : "rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
              }
            >
              {s.shortTitle}
            </Link>
          ))}
        </div>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-800">
          {loadError}
        </div>
      ) : (
        <DirectorySourcePanel
          source={source}
          items={items}
          total={total}
          stats={stats}
        />
      )}
    </div>
  );
}
