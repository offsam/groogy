import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CatalogBrowser } from "@/components/admin/CatalogBrowser";
import { listCatalogProfessionals } from "@/lib/admin/catalog/queries";
import type {
  CatalogSort,
  CatalogStatusFilter,
} from "@/lib/admin/catalog/types";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Professionals — Catalog — Admin",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending: "Pending",
  approved: "Published",
  rejected: "Rejected",
  archived: "Archived",
  deferred: "Deferred",
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

function locationLine(p: {
  city: string | null;
  region: string | null;
  stateCode: string | null;
}): string {
  const parts = [p.city, p.stateCode].filter(Boolean);
  if (parts.length) return parts.join(", ");
  return p.region?.trim() || "Без локации";
}

export default async function AdminCatalogProfessionalsPage({
  searchParams,
}: PageProps) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/catalog/professionals");
  if (!(await userIsAdmin(supabase))) redirect("/");

  const params = await searchParams;
  const q = params.q ?? "";
  const status = parseStatus(params.status);
  const sort = parseSort(params.sort);
  const page = Math.max(1, Number(params.page || "1") || 1);

  let result: Awaited<ReturnType<typeof listCatalogProfessionals>> = {
    items: [],
    total: 0,
    page,
    pageSize: 24,
  };
  let loadError: string | null = null;

  try {
    result = await listCatalogProfessionals(supabase, {
      q,
      status,
      sort,
      page,
    });
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "Не удалось загрузить специалистов";
  }

  return (
    <CatalogBrowser
      title="Professionals"
      description="Опубликованные и архивные профили специалистов. Модерация кандидатов — в Review Center."
      basePath="/admin/catalog/professionals"
      layout="list"
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      q={q}
      status={status}
      sort={sort}
      legacyHref="/admin/review/inbox?view=professionals"
      legacyLabel="Professionals in Inbox"
      sectionEnrichKind="professional"
      error={loadError}
      items={result.items.map((p) => ({
        meta: {
          id: p.id,
          title: p.displayName,
          statusLabel: STATUS_LABELS[p.status] ?? p.status,
          locationLine: locationLine(p),
          categoryLabel: p.categoryName,
          createdAt: p.createdAt,
          publicHref:
            p.status === "approved" ? `/professional/${p.slug}` : null,
          editHref: `/professional/${p.slug}/edit`,
          archiveAvailable: false,
          enrichKind: "professional" as const,
          slug: p.slug,
        },
      }))}
    />
  );
}
