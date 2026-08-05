import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CatalogBrowser } from "@/components/admin/CatalogBrowser";
import { listCatalogChurches } from "@/lib/admin/catalog/queries";
import type {
  CatalogSort,
  CatalogStatusFilter,
} from "@/lib/admin/catalog/types";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Churches — Catalog — Admin",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  approved: "Published",
  archived: "Archived",
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

function locationLine(c: {
  city: string | null;
  stateCode: string | null;
  region: string | null;
}): string {
  const parts = [c.city, c.stateCode].filter(Boolean);
  if (parts.length) return parts.join(", ");
  return c.region?.trim() || "Без локации";
}

export default async function AdminCatalogChurchesPage({
  searchParams,
}: PageProps) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/catalog/churches");
  if (!(await userIsAdmin(supabase))) redirect("/");

  const params = await searchParams;
  const q = params.q ?? "";
  const status = parseStatus(params.status);
  const sort = parseSort(params.sort);
  const page = Math.max(1, Number(params.page || "1") || 1);

  let result: Awaited<ReturnType<typeof listCatalogChurches>> = {
    items: [],
    total: 0,
    page,
    pageSize: 24,
  };
  let loadError: string | null = null;

  try {
    result = await listCatalogChurches(supabase, { q, status, sort, page });
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "Не удалось загрузить церкви";
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          Список церквей. Создайте вручную — импорт из очереди пока не
          подключён.
        </p>
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-blue px-4 text-sm font-semibold text-white hover:bg-brand-blue/90"
          href="/admin/catalog/churches/new"
        >
          Добавить церковь
        </Link>
      </div>
      <CatalogBrowser
        title="Церкви"
        description="Опубликованные и черновые карточки церквей."
        basePath="/admin/catalog/churches"
        layout="list"
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        q={q}
        status={status}
        sort={sort}
        sectionEnrichKind="church"
        error={loadError}
        items={result.items.map((church) => ({
          meta: {
            id: church.id,
            title: church.name,
            statusLabel: STATUS_LABELS[church.status] ?? church.status,
            locationLine: locationLine(church),
            createdAt: church.createdAt,
            publicHref:
              church.status === "approved" ? `/churches/${church.slug}` : null,
            editHref: `/admin/catalog/churches/${church.id}/edit`,
            archiveAvailable: false,
            slug: church.slug,
            enrichKind: "church",
          },
        }))}
      />
    </div>
  );
}
