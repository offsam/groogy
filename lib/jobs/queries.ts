import type { SupabaseClient } from "@supabase/supabase-js";
import { mapJob } from "@/lib/jobs/mappers";
import {
  getRegionHubsByIds,
  locationTextMatchesHub,
  parseHubIds,
} from "@/lib/regions/hubs";
import type { Database } from "@/types/database";
import type { Job, JobRow } from "@/types/job";

type Client = SupabaseClient<Database>;

function db(client: Client) {
  return client as unknown as SupabaseClient;
}

const JOB_SELECT =
  "id, slug, title, description, city, state_code, postal_code, status, business_id, published_at, created_at, businesses(id, slug, name, image_url, city, region, address_line, location_precision)";

/** Empty city = nationwide / no regional binding → visible in every hub. */
export function jobMatchesHubFilter(
  job: Pick<JobRow, "city">,
  hubId: string | null | undefined,
): boolean {
  if (!hubId?.trim()) return true;
  const city = job.city?.trim();
  if (!city) return true;
  const hubs = getRegionHubsByIds(parseHubIds(hubId));
  return hubs.some((hub) => locationTextMatchesHub(city, hub));
}

export async function listPublishedJobs(
  client: Client,
  options?: { limit?: number; hubId?: string | null },
): Promise<Job[]> {
  const limit = options?.limit ?? 60;
  const overFetch = options?.hubId ? Math.min(Math.max(limit * 5, limit), 2000) : limit;

  const { data, error } = await db(client)
    .from("jobs")
    .select(JOB_SELECT)
    .eq("status", "published")
    .eq("visibility", "public")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(overFetch);

  if (error) throw error;
  let rows = (data ?? []) as unknown as JobRow[];

  if (options?.hubId) {
    rows = rows.filter((job) => jobMatchesHubFilter(job, options.hubId));
  }

  return rows.slice(0, limit).map(mapJob);
}

export async function listJobsForBusiness(
  client: Client,
  businessId: string,
  options?: { includeDrafts?: boolean },
): Promise<Job[]> {
  let q = db(client)
    .from("jobs")
    .select(JOB_SELECT)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });

  if (!options?.includeDrafts) {
    q = q.eq("status", "published").eq("visibility", "public");
  } else {
    q = q.neq("status", "archived");
  }

  const { data, error } = await q.limit(40);
  if (error) throw error;
  return ((data ?? []) as unknown as JobRow[]).map(mapJob);
}

export async function getJobBySlug(
  client: Client,
  slug: string,
): Promise<Job | null> {
  const { data, error } = await db(client)
    .from("jobs")
    .select(JOB_SELECT)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapJob(data as unknown as JobRow);
}

export async function countPublishedJobs(client: Client): Promise<number> {
  const { count, error } = await db(client)
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "published")
    .eq("visibility", "public");
  if (error) throw error;
  return count ?? 0;
}
