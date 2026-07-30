import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CatalogBrowser } from "@/components/admin/CatalogBrowser";
import { JobCard } from "@/components/jobs/JobCard";
import { listCatalogJobs } from "@/lib/admin/catalog/queries";
import type {
  CatalogSort,
  CatalogStatusFilter,
} from "@/lib/admin/catalog/types";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Jobs — Catalog — Admin",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending: "Pending",
  published: "Published",
  archived: "Archived",
  rejected: "Rejected",
  expired: "Expired",
};

function parseStatus(raw: string | undefined): CatalogStatusFilter {
  const allowed = new Set([
    "all",
    "published",
    "draft",
    "archived",
    "other",
  ]);
  return allowed.has(raw ?? "")
    ? (raw as CatalogStatusFilter)
    : "published";
}

function parseSort(raw: string | undefined): CatalogSort {
  if (raw === "oldest" || raw === "title") return raw;
  return "newest";
}

export default async function AdminCatalogJobsPage({
  searchParams,
}: PageProps) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/catalog/jobs");
  if (!(await userIsAdmin(supabase))) redirect("/");

  const params = await searchParams;
  const q = params.q ?? "";
  const status = parseStatus(params.status);
  const sort = parseSort(params.sort);
  const page = Math.max(1, Number(params.page || "1") || 1);

  let result: Awaited<ReturnType<typeof listCatalogJobs>> = {
    items: [],
    total: 0,
    page,
    pageSize: 24,
  };
  let loadError: string | null = null;

  try {
    result = await listCatalogJobs(supabase, { q, status, sort, page });
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "Не удалось загрузить вакансии";
  }

  return (
    <CatalogBrowser
      title="Jobs"
      description="Опубликованные вакансии каталога. Кандидаты из импорта — в Review Center."
      basePath="/admin/catalog/jobs"
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      q={q}
      status={status}
      sort={sort}
      legacyHref="/admin/import-review?collection=jobs"
      legacyLabel="Jobs in Import Review"
      error={loadError}
      items={result.items.map((job) => ({
        meta: {
          id: job.id,
          statusLabel: STATUS_LABELS[job.status] ?? job.status,
          publicHref:
            job.status === "published" ? `/jobs/${job.slug}` : null,
          editHref: job.businessSlug
            ? `/business/${job.businessSlug}/manage`
            : null,
          archiveAvailable: false,
          enrichKind: "job" as const,
          slug: job.slug,
        },
        card: <JobCard job={job} preview />,
      }))}
    />
  );
}
