import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CatalogBrowser } from "@/components/admin/CatalogBrowser";
import { getAdminListings } from "@/lib/listings/queries";
import type {
  CatalogSort,
  CatalogStatusFilter,
} from "@/lib/admin/catalog/types";
import { CATALOG_PAGE_SIZE } from "@/lib/admin/catalog/types";
import { LISTING_STATUS_LABELS } from "@/types/listing";

const TYPE_LABELS: Record<string, string> = {
  marketplace_item: "Маркетплейс",
  service: "Услуга",
  transfer: "Трансфер",
  transport_carry: "Лечу",
};
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Marketplace — Catalog — Admin",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

function bucket(status: string): CatalogStatusFilter {
  if (status === "active") return "published";
  if (status === "paused" || status === "draft") return "draft";
  if (status === "removed" || status === "completed") return "archived";
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

function publicHrefFor(listing: { id: string; listingType?: string | null }) {
  const type = listing.listingType ?? "";
  if (type === "service") return `/services/${listing.id}`;
  if (type === "transfer") return `/transfers/${listing.id}`;
  if (type === "transport_carry") return `/lechu/${listing.id}`;
  return `/marketplace/${listing.id}`;
}

function enrichKindFor(
  listingType: string | null | undefined,
): "service" | "transfer" | "marketplace" | "lechu" | undefined {
  if (listingType === "service") return "service";
  if (listingType === "transfer") return "transfer";
  if (listingType === "marketplace_item") return "marketplace";
  if (listingType === "transport_carry") return "lechu";
  return undefined;
}

export default async function AdminCatalogMarketplacePage({
  searchParams,
}: PageProps) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/catalog/marketplace");
  if (!(await userIsAdmin(supabase))) redirect("/");

  const params = await searchParams;
  const q = params.q ?? "";
  const status = parseStatus(params.status);
  const sort = parseSort(params.sort);
  const page = Math.max(1, Number(params.page || "1") || 1);

  let loadError: string | null = null;
  let rows: Awaited<ReturnType<typeof getAdminListings>> = [];

  try {
    rows = await getAdminListings(supabase, "all", q || null, "marketplace");
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "Не удалось загрузить объявления";
  }

  let filtered = rows;
  if (status !== "all") {
    filtered = filtered.filter((r) => bucket(r.status) === status);
  }

  filtered = [...filtered].sort((a, b) => {
    if (sort === "title") return a.title.localeCompare(b.title, "ru");
    const ta = Date.parse(a.createdAt || a.updatedAt || "") || 0;
    const tb = Date.parse(b.createdAt || b.updatedAt || "") || 0;
    return sort === "oldest" ? ta - tb : tb - ta;
  });

  const total = filtered.length;
  const pageSize = CATALOG_PAGE_SIZE;
  const slice = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <CatalogBrowser
      title="Marketplace"
      description="Объявления marketplace. Жалобы и расширенная модерация — в legacy Listings."
      basePath="/admin/catalog/marketplace"
      layout="list"
      total={total}
      page={page}
      pageSize={pageSize}
      q={q}
      status={status}
      sort={sort}
      legacyHref="/admin/listings?domain=marketplace"
      legacyLabel="Listings moderation"
      sectionEnrichKind="marketplace"
      error={loadError}
      items={slice.map((row) => ({
        meta: {
          id: row.id,
          title: row.title,
          statusLabel:
            LISTING_STATUS_LABELS[
              row.status as keyof typeof LISTING_STATUS_LABELS
            ] ?? row.status,
          locationLine: row.city?.trim() || "Без локации",
          categoryLabel:
            TYPE_LABELS[row.listingType] ||
            row.marketplace?.category?.nameRu ||
            row.service?.category?.nameRu ||
            null,
          createdAt: row.createdAt,
          publicHref:
            row.status === "active" ? publicHrefFor(row) : null,
          editHref: `/marketplace/${row.id}/edit`,
          archiveAvailable: false,
          enrichKind: enrichKindFor(row.listingType),
        },
      }))}
    />
  );
}
