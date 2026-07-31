import type { SupabaseClient } from "@supabase/supabase-js";
import { ENTITY_DESCRIPTION_ORIGINAL_READY } from "@/lib/content/description-original";
import { mapJob } from "@/lib/jobs/mappers";
import {
  getRegionHubsByIds,
  isUsaOverviewHub,
  locationFieldsMatchHub,
  parseHubIds,
} from "@/lib/regions/hubs";
import {
  countyGeoidMatchesPlaces,
  parsePlaceTokens,
} from "@/lib/geo/place-tokens";
import { normalizeRouteSlug } from "@/lib/routing/normalize-route-slug";
import type { Database } from "@/types/database";
import type { Job, JobRow } from "@/types/job";

type Client = SupabaseClient<Database>;

function db(client: Client) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jobs table typing lag
  return client as unknown as import("@supabase/supabase-js").SupabaseClient<any>;
}

const JOB_SELECT = ENTITY_DESCRIPTION_ORIGINAL_READY
  ? "id, slug, title, description, description_original, city, state_code, postal_code, county_geoid, status, payment_methods, business_id, published_at, created_at, businesses(id, slug, name, image_url, city, region, address_line, location_precision)"
  : "id, slug, title, description, city, state_code, postal_code, county_geoid, status, payment_methods, business_id, published_at, created_at, businesses(id, slug, name, image_url, city, region, address_line, location_precision)";

/** Empty city = nationwide / no regional binding → visible in every hub. */
export function jobMatchesHubFilter(
  job: Pick<JobRow, "city"> & { county_geoid?: string | null },
  hubId: string | null | undefined,
): boolean {
  if (!hubId?.trim()) return true;
  const hubs = getRegionHubsByIds(parseHubIds(hubId));
  if (hubs.length === 1 && isUsaOverviewHub(hubs[0])) return true;
  if (job.county_geoid) {
    if (hubId.includes("county:") || hubId.includes("city:")) {
      const match = countyGeoidMatchesPlaces(
        job.county_geoid,
        parsePlaceTokens(hubId),
      );
      if (match !== null) return match;
    }
    const allowed = hubs.flatMap((h) => [...h.countyGeoids]);
    if (allowed.length > 0) return allowed.includes(job.county_geoid);
  }
  const city = job.city?.trim();
  if (!city) return true;
  return hubs.some((hub) =>
    locationFieldsMatchHub(
      { city, countyGeoid: job.county_geoid },
      hub,
    ),
  );
}

export async function listPublishedJobs(
  client: Client,
  options?: { limit?: number; hubId?: string | null },
): Promise<Job[]> {
  const limit = options?.limit ?? 60;
  const overFetch = options?.hubId ? Math.min(Math.max(limit * 5, limit), 2000) : limit;

  const { data, error } = await db(client)
    .from("jobs")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- select string + join blows TS depth
    .select(JOB_SELECT as any)
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select(JOB_SELECT as any)
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
  const normalized = normalizeRouteSlug(slug);
  const { data, error } = await db(client)
    .from("jobs")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select(JOB_SELECT as any)
    .eq("slug", normalized)
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
