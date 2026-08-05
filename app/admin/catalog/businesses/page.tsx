import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CatalogBrowser } from "@/components/admin/CatalogBrowser";
import {
  listCatalogBusinessCategoryOptions,
  listCatalogBusinessCountyOptions,
  listCatalogBusinesses,
  listCatalogBusinessStateOptions,
} from "@/lib/admin/catalog/business-queries";
import {
  CATALOG_FILTER_NONE,
  CATALOG_PAGE_SIZE,
  type CatalogSort,
  type CatalogStatusFilter,
} from "@/lib/admin/catalog/types";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Бизнесы — Каталог — Admin",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Черновик",
  pending: "На проверке",
  approved: "Опубликован",
  rejected: "Отклонён",
  archived: "Архив",
  deferred: "Отложен",
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

function parseFilterToken(raw: string | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  if (v === CATALOG_FILTER_NONE) return CATALOG_FILTER_NONE;
  return v;
}

function locationLine(row: {
  city: string | null;
  county_name: string | null;
  state_code: string | null;
  region: string | null;
}): string {
  const parts = [
    row.city,
    row.county_name
      ? row.county_name.replace(/\s+County$/i, "") + " County"
      : null,
    row.state_code,
  ].filter(Boolean);
  if (parts.length) return parts.join(", ");
  return row.region?.trim() || "Без локации";
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
  const q = (params.q ?? "").trim();
  const status = parseStatus(params.status);
  const sort = parseSort(params.sort);
  const page = Math.max(1, Number(params.page || "1") || 1);
  const state = parseFilterToken(params.state);
  const countyRaw = parseFilterToken(params.county);
  // County only applies when a concrete state is selected.
  const county =
    state && state !== CATALOG_FILTER_NONE ? countyRaw : "";
  const category = parseFilterToken(params.category);

  let loadError: string | null = null;
  let total = 0;
  let items: Awaited<ReturnType<typeof listCatalogBusinesses>>["items"] = [];
  let stateOptions: Awaited<
    ReturnType<typeof listCatalogBusinessStateOptions>
  > = [];
  let countyOptions: Awaited<
    ReturnType<typeof listCatalogBusinessCountyOptions>
  > = [];
  let categoryOptions: Awaited<
    ReturnType<typeof listCatalogBusinessCategoryOptions>
  > = [];

  try {
    const [list, states, categories, counties] = await Promise.all([
      listCatalogBusinesses(supabase, {
        status,
        state: state || null,
        county: county || null,
        category: category || null,
        q,
        page,
        pageSize: CATALOG_PAGE_SIZE,
        sort,
      }),
      listCatalogBusinessStateOptions(supabase, status),
      listCatalogBusinessCategoryOptions(supabase, status),
      state && state !== CATALOG_FILTER_NONE
        ? listCatalogBusinessCountyOptions(supabase, state)
        : Promise.resolve([]),
    ]);
    items = list.items;
    total = list.total;
    stateOptions = states;
    categoryOptions = categories;
    countyOptions = counties;
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "Не удалось загрузить бизнесы";
  }

  return (
    <CatalogBrowser
      title="Бизнесы"
      description="Опубликованные бизнесы — фильтр по штату, округу и категории. Найди компанию и открой Edit."
      basePath="/admin/catalog/businesses"
      layout="list"
      total={total}
      page={page}
      pageSize={CATALOG_PAGE_SIZE}
      q={q}
      status={status}
      sort={sort}
      state={state}
      county={county}
      category={category}
      stateOptions={stateOptions}
      countyOptions={countyOptions}
      categoryOptions={categoryOptions}
      sectionEnrichKind="business"
      legacyHref="/admin/businesses"
      legacyLabel="Merge / полная модерация"
      error={loadError}
      items={items.map((row) => ({
        meta: {
          id: row.id,
          title: row.name,
          statusLabel: STATUS_LABELS[row.status] ?? row.status,
          locationLine: locationLine(row),
          categoryLabel: row.categories?.name ?? null,
          createdAt: row.created_at,
          publicHref:
            row.status === "approved" ? `/business/${row.slug}` : null,
          editHref: `/admin/businesses/${row.id}/edit`,
          archiveAvailable: false,
          enrichKind: "business" as const,
          slug: row.slug,
        },
      }))}
    />
  );
}
