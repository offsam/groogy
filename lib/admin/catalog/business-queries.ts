/**
 * Admin catalog — published businesses with geo/category filters (DB-side).
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  CATALOG_FILTER_NONE,
  CATALOG_PAGE_SIZE,
  type CatalogFilterOption,
  type CatalogSort,
  type CatalogStatusFilter,
} from "@/lib/admin/catalog/types";

type Client = SupabaseClient<Database>;

function db(client: Client) {
  return client as unknown as SupabaseClient;
}

export type CatalogBusinessRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  phone: string | null;
  city: string | null;
  state_code: string | null;
  county_geoid: string | null;
  region: string | null;
  address_line: string | null;
  category_id: string | null;
  image_url: string | null;
  short_description: string | null;
  created_at: string;
  updated_at: string | null;
  categories: {
    id: string;
    slug: string;
    name: string;
    icon: string | null;
  } | null;
  /** Resolved county name when geoid known */
  county_name: string | null;
};

export type CatalogBusinessListResult = {
  items: CatalogBusinessRow[];
  total: number;
  page: number;
  pageSize: number;
};

const BUSINESS_SELECT = `
  id,
  slug,
  name,
  status,
  phone,
  city,
  state_code,
  county_geoid,
  region,
  address_line,
  category_id,
  image_url,
  short_description,
  created_at,
  updated_at,
  categories (
    id,
    slug,
    name,
    icon
  )
`;

function statusesForBucket(status: CatalogStatusFilter): string[] | null {
  if (status === "all") return null;
  if (status === "published") return ["approved"];
  if (status === "draft") return ["draft", "pending", "deferred"];
  if (status === "archived") return ["archived"];
  return ["rejected"];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyBusinessFilters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  opts: {
    status: CatalogStatusFilter;
    state?: string | null;
    county?: string | null;
    category?: string | null;
    q?: string;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const statuses = statusesForBucket(opts.status);
  if (statuses) {
    query = query.in("status", statuses);
  }

  if (opts.state === CATALOG_FILTER_NONE) {
    query = query.is("state_code", null);
  } else if (opts.state) {
    query = query.eq("state_code", opts.state);
  }

  if (opts.county === CATALOG_FILTER_NONE) {
    query = query.is("county_geoid", null);
  } else if (opts.county) {
    query = query.eq("county_geoid", opts.county);
  }

  if (opts.category === CATALOG_FILTER_NONE) {
    query = query.is("category_id", null);
  } else if (opts.category) {
    query = query.eq("category_id", opts.category);
  }

  const q = opts.q?.trim();
  if (q) {
    const safe = q.replace(/[%_,]/g, "").slice(0, 80);
    if (safe) {
      query = query.or(
        `name.ilike.%${safe}%,city.ilike.%${safe}%,slug.ilike.%${safe}%,phone.ilike.%${safe}%`,
      );
    }
  }

  return query;
}

function normalizeCategoryJoin(
  raw:
    | CatalogBusinessRow["categories"]
    | NonNullable<CatalogBusinessRow["categories"]>[]
    | null,
): CatalogBusinessRow["categories"] {
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

export async function listCatalogBusinesses(
  client: Client,
  opts: {
    status?: CatalogStatusFilter;
    state?: string | null;
    county?: string | null;
    category?: string | null;
    q?: string;
    page?: number;
    pageSize?: number;
    sort?: CatalogSort;
  } = {},
): Promise<CatalogBusinessListResult> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? CATALOG_PAGE_SIZE));
  const sort = opts.sort ?? "newest";
  const status = opts.status ?? "published";
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const filter = {
    status,
    state: opts.state ?? null,
    county: opts.county ?? null,
    category: opts.category ?? null,
    q: opts.q,
  };

  let query = db(client)
    .from("businesses")
    .select(BUSINESS_SELECT, { count: "exact" });
  query = applyBusinessFilters(query, filter);

  if (sort === "title") {
    query = query.order("name", { ascending: true });
  } else {
    query = query.order("created_at", { ascending: sort === "oldest" });
  }

  const { data, error, count } = await query.range(from, to);
  if (error) throw error;

  const rows = (data ?? []) as Array<
    Omit<CatalogBusinessRow, "categories" | "county_name"> & {
      categories:
        | CatalogBusinessRow["categories"]
        | NonNullable<CatalogBusinessRow["categories"]>[]
        | null;
    }
  >;

  const geoids = [
    ...new Set(
      rows
        .map((r) => r.county_geoid)
        .filter((g): g is string => Boolean(g)),
    ),
  ];
  const countyNames = new Map<string, string>();
  if (geoids.length > 0) {
    const { data: counties } = await db(client)
      .from("platform_counties")
      .select("geoid, name")
      .in("geoid", geoids);
    for (const c of (counties ?? []) as Array<{ geoid: string; name: string }>) {
      countyNames.set(c.geoid, c.name);
    }
  }

  const items: CatalogBusinessRow[] = rows.map((row) => ({
    ...row,
    categories: normalizeCategoryJoin(row.categories),
    county_name: row.county_geoid
      ? (countyNames.get(row.county_geoid) ?? null)
      : null,
  }));

  return {
    items,
    total: count ?? items.length,
    page,
    pageSize,
  };
}

export async function listCatalogBusinessStateOptions(
  client: Client,
  status: CatalogStatusFilter = "published",
): Promise<CatalogFilterOption[]> {
  const statuses = statusesForBucket(status);
  let query = db(client).from("businesses").select("state_code");
  if (statuses) query = query.in("status", statuses);

  const { data, error } = await query.limit(5000);
  if (error) throw error;

  const set = new Set<string>();
  let hasNone = false;
  for (const row of (data ?? []) as Array<{ state_code?: string | null }>) {
    const code = row.state_code?.trim();
    if (!code) hasNone = true;
    else set.add(code.toUpperCase());
  }

  const options: CatalogFilterOption[] = [...set]
    .sort((a, b) => a.localeCompare(b, "en"))
    .map((id) => ({ id, label: id }));

  if (hasNone) {
    options.push({ id: CATALOG_FILTER_NONE, label: "Без штата" });
  }
  return options;
}

export async function listCatalogBusinessCountyOptions(
  client: Client,
  stateCode: string,
): Promise<CatalogFilterOption[]> {
  const code = stateCode.trim().toUpperCase();
  if (!code || code === CATALOG_FILTER_NONE) return [];

  const { data, error } = await db(client)
    .from("platform_counties")
    .select("geoid, name")
    .eq("state_code", code)
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error) throw error;

  const options: CatalogFilterOption[] = (
    (data ?? []) as Array<{ geoid: string; name: string }>
  ).map((c) => ({
    id: c.geoid,
    label: c.name.replace(/\s+County$/i, "") + " County",
  }));

  options.push({ id: CATALOG_FILTER_NONE, label: "Без округа" });
  return options;
}

export async function listCatalogBusinessCategoryOptions(
  client: Client,
  status: CatalogStatusFilter = "published",
): Promise<CatalogFilterOption[]> {
  const statuses = statusesForBucket(status);
  let query = db(client).from("businesses").select("category_id");
  if (statuses) query = query.in("status", statuses);

  const { data: used, error: usedError } = await query.limit(5000);
  if (usedError) throw usedError;

  const ids = new Set<string>();
  let hasNone = false;
  for (const row of (used ?? []) as Array<{ category_id?: string | null }>) {
    if (!row.category_id) hasNone = true;
    else ids.add(row.category_id);
  }

  if (ids.size === 0) {
    const { data: all } = await db(client)
      .from("categories")
      .select("id, name")
      .order("name", { ascending: true })
      .limit(500);
    const options = (
      (all ?? []) as Array<{ id: string; name: string }>
    ).map((c) => ({ id: c.id, label: c.name }));
    if (hasNone) {
      options.push({ id: CATALOG_FILTER_NONE, label: "Без категории" });
    }
    return options;
  }

  const { data: cats, error } = await db(client)
    .from("categories")
    .select("id, name")
    .in("id", [...ids])
    .order("name", { ascending: true });
  if (error) throw error;

  const options: CatalogFilterOption[] = (
    (cats ?? []) as Array<{ id: string; name: string }>
  ).map((c) => ({ id: c.id, label: c.name }));

  if (hasNone) {
    options.push({ id: CATALOG_FILTER_NONE, label: "Без категории" });
  }
  return options;
}
