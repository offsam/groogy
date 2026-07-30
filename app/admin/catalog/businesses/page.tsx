import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CatalogBrowser } from "@/components/admin/CatalogBrowser";
import { BusinessCard } from "@/components/business/BusinessCard";
import {
  adminBusinessToPreview,
  getAdminBusinesses,
} from "@/lib/business/admin-queries";
import type {
  CatalogSort,
  CatalogStatusFilter,
} from "@/lib/admin/catalog/types";
import { CATALOG_PAGE_SIZE } from "@/lib/admin/catalog/types";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Businesses — Catalog — Admin",
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

function bucket(status: string): CatalogStatusFilter {
  if (status === "approved") return "published";
  if (status === "draft" || status === "pending" || status === "deferred") {
    return "draft";
  }
  if (status === "archived") return "archived";
  return "other";
}

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

export default async function AdminCatalogBusinessesPage({
  searchParams,
}: PageProps) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/catalog/businesses");
  if (!(await userIsAdmin(supabase))) redirect("/");

  const params = await searchParams;
  const q = (params.q ?? "").trim().toLowerCase();
  const status = parseStatus(params.status);
  const sort = parseSort(params.sort);
  const page = Math.max(1, Number(params.page || "1") || 1);

  let loadError: string | null = null;
  let rows: Awaited<ReturnType<typeof getAdminBusinesses>> = [];

  try {
    rows = await getAdminBusinesses(supabase);
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "Не удалось загрузить бизнесы";
  }

  let filtered = rows;
  if (status !== "all") {
    filtered = filtered.filter((r) => bucket(r.status) === status);
  }
  if (q) {
    filtered = filtered.filter((r) => {
      const hay = [r.name, r.city, r.slug, r.phone]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  filtered = [...filtered].sort((a, b) => {
    if (sort === "title") return a.name.localeCompare(b.name, "ru");
    const ta = Date.parse(a.created_at) || 0;
    const tb = Date.parse(b.created_at) || 0;
    return sort === "oldest" ? ta - tb : tb - ta;
  });

  const total = filtered.length;
  const pageSize = CATALOG_PAGE_SIZE;
  const slice = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <CatalogBrowser
      title="Businesses"
      description="Каталог бизнесов. Merge дубликатов и расширенная модерация — в legacy-инструменте."
      basePath="/admin/catalog/businesses"
      total={total}
      page={page}
      pageSize={pageSize}
      q={params.q ?? ""}
      status={status}
      sort={sort}
      legacyHref="/admin/businesses"
      legacyLabel="Merge / полная модерация"
      error={loadError}
      items={slice.map((row) => ({
        meta: {
          id: row.id,
          statusLabel: STATUS_LABELS[row.status] ?? row.status,
          publicHref:
            row.status === "approved" ? `/business/${row.slug}` : null,
          editHref: `/admin/businesses/${row.id}/edit`,
          archiveAvailable: false,
          enrichKind: "business" as const,
          slug: row.slug,
        },
        card: (
          <BusinessCard business={adminBusinessToPreview(row)} preview />
        ),
      }))}
    />
  );
}
