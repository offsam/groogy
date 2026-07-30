import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { mapProfessionalOwner } from "@/lib/professional/mappers";
import { mapJob } from "@/lib/jobs/mappers";
import type { Professional, ProfessionalRow } from "@/types/professional";
import type { Job, JobRow } from "@/types/job";
import type { PlatformEvent } from "@/lib/events/queries";
import {
  CATALOG_PAGE_SIZE,
  type CatalogSort,
  type CatalogStatusFilter,
} from "@/lib/admin/catalog/types";

type Client = SupabaseClient<Database>;

function db(client: Client) {
  return client as unknown as SupabaseClient;
}

function eventsTable(client: Client) {
  return db(client).from("events");
}

export type CatalogListResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

function normalizeStatusFilter(status: CatalogStatusFilter | undefined) {
  return status && status !== "all" ? status : "all";
}

/** Map entity statuses into Catalog status buckets. */
function professionalStatusBucket(status: string): CatalogStatusFilter {
  if (status === "approved") return "published";
  if (status === "draft" || status === "pending" || status === "deferred") {
    return "draft";
  }
  if (status === "archived") return "archived";
  return "other";
}

function jobStatusBucket(status: string): CatalogStatusFilter {
  if (status === "published") return "published";
  if (status === "draft" || status === "pending") return "draft";
  if (status === "archived" || status === "expired") return "archived";
  return "other";
}

function eventStatusBucket(status: string): CatalogStatusFilter {
  if (status === "published") return "published";
  if (status === "draft" || status === "pending") return "draft";
  if (status === "archived" || status === "cancelled") return "archived";
  return "other";
}

function applySort<T extends { createdAt?: string | null; publishedAt?: string | null; title?: string; displayName?: string }>(
  items: T[],
  sort: CatalogSort,
  titleOf: (item: T) => string,
): T[] {
  const copy = [...items];
  if (sort === "title") {
    copy.sort((a, b) => titleOf(a).localeCompare(titleOf(b), "ru"));
    return copy;
  }
  const asc = sort === "oldest";
  copy.sort((a, b) => {
    const ta = Date.parse(a.publishedAt || a.createdAt || "") || 0;
    const tb = Date.parse(b.publishedAt || b.createdAt || "") || 0;
    return asc ? ta - tb : tb - ta;
  });
  return copy;
}

const PRO_SELECT =
  "id, slug, display_name, headline, short_description, description, card_summary, image_url, status, experience_years, languages, availability_text, rating_avg, reviews_count, city, region, state_code, postal_code, latitude, longitude, service_area_text, published_at, created_at, category_id, owner_profile_id, phone, email, website, instagram_url, telegram_url, source_type, source_url, visibility, third_party_mention_count, self_ad_mention_count";

export async function listCatalogProfessionals(
  client: Client,
  opts: {
    status?: CatalogStatusFilter;
    q?: string;
    page?: number;
    pageSize?: number;
    sort?: CatalogSort;
  } = {},
): Promise<CatalogListResult<Professional>> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? CATALOG_PAGE_SIZE));
  const sort = opts.sort ?? "newest";
  const status = normalizeStatusFilter(opts.status);
  const q = opts.q?.trim().toLowerCase() ?? "";

  // Fetch a bounded set (admin catalog) then filter/paginate in memory —
  // avoids new RPCs; catalog size is moderate.
  const { data, error } = await db(client)
    .from("professionals")
    .select(PRO_SELECT)
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) throw error;

  let items = ((data ?? []) as ProfessionalRow[]).map(mapProfessionalOwner);

  if (status !== "all") {
    items = items.filter((p) => professionalStatusBucket(p.status) === status);
  }
  if (q) {
    items = items.filter((p) => {
      const hay = [
        p.displayName,
        p.headline,
        p.city,
        p.categoryName,
        p.slug,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  items = applySort(items, sort, (p) => p.displayName);
  const total = items.length;
  const from = (page - 1) * pageSize;
  return {
    items: items.slice(from, from + pageSize),
    total,
    page,
    pageSize,
  };
}

const JOB_SELECT =
  "id, slug, title, description, city, state_code, postal_code, status, business_id, published_at, created_at, businesses(id, slug, name, image_url, city, region, address_line, location_precision)";

export async function listCatalogJobs(
  client: Client,
  opts: {
    status?: CatalogStatusFilter;
    q?: string;
    page?: number;
    pageSize?: number;
    sort?: CatalogSort;
  } = {},
): Promise<CatalogListResult<Job>> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? CATALOG_PAGE_SIZE));
  const sort = opts.sort ?? "newest";
  const status = normalizeStatusFilter(opts.status);
  const q = opts.q?.trim().toLowerCase() ?? "";

  const { data, error } = await db(client)
    .from("jobs")
    .select(JOB_SELECT)
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) throw error;

  let items = ((data ?? []) as unknown as JobRow[]).map(mapJob);

  if (status !== "all") {
    items = items.filter((j) => jobStatusBucket(j.status) === status);
  }
  if (q) {
    items = items.filter((j) => {
      const hay = [j.title, j.city, j.businessName, j.slug]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  items = applySort(
    items.map((j) => ({ ...j, title: j.title })),
    sort,
    (j) => j.title,
  );
  const total = items.length;
  const from = (page - 1) * pageSize;
  return {
    items: items.slice(from, from + pageSize),
    total,
    page,
    pageSize,
  };
}

export async function listCatalogEvents(
  client: Client,
  opts: {
    status?: CatalogStatusFilter;
    q?: string;
    page?: number;
    pageSize?: number;
    sort?: CatalogSort;
  } = {},
): Promise<CatalogListResult<PlatformEvent>> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? CATALOG_PAGE_SIZE));
  const sort = opts.sort ?? "newest";
  const status = normalizeStatusFilter(opts.status);
  const q = opts.q?.trim().toLowerCase() ?? "";

  const { data, error } = await eventsTable(client)
    .select(
      "id, title, slug, description, status, starts_at, ends_at, event_at_label, city, cover_image_url, registration_url, source_url, source_posted_at, source_body, format, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) throw error;

  let items = (data ?? []) as PlatformEvent[];

  if (status !== "all") {
    items = items.filter((e) => eventStatusBucket(e.status) === status);
  }
  if (q) {
    items = items.filter((e) => {
      const hay = [e.title, e.city, e.slug, e.format]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  const withDates = items.map((e) => ({
    ...e,
    publishedAt: e.starts_at || e.created_at,
    createdAt: e.created_at,
  }));
  const sorted = applySort(withDates, sort, (e) => e.title);
  const total = sorted.length;
  const from = (page - 1) * pageSize;
  return {
    items: sorted.slice(from, from + pageSize),
    total,
    page,
    pageSize,
  };
}
