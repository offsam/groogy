import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
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
import { mapChurchOwner, mapChurchPublic } from "@/lib/churches/mappers";
import type { Database } from "@/types/database";
import type { Church, ChurchPublicRow, ChurchRow } from "@/types/church";

type Client = SupabaseClient<Database>;

function db(client: Client) {
  return client as unknown as SupabaseClient;
}

const CHURCH_OWNER_SELECT =
  "id, slug, name, description, description_original, image_url, status, address_line, city, state_code, postal_code, region, county_geoid, latitude, longitude, location_precision, phone, email, website, instagram_url, telegram_url, google_maps_url, contact_links, source_url, source_kind, opening_hours, schedule_text, ministries, published_at, created_at, updated_at, archived_at";

export async function listApprovedChurches(
  client: Client,
  options?: {
    limit?: number;
    hubId?: string | null;
    q?: string | null;
  },
): Promise<Church[]> {
  const limit = options?.limit ?? 48;
  const overFetch = options?.hubId
    ? Math.min(Math.max(limit * 2, limit), 5000)
    : limit;

  let query = db(client)
    .from("churches_public")
    .select("*")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(overFetch);

  const q = options?.q?.trim();
  if (q) {
    query = query.or(
      `name.ilike.%${q}%,city.ilike.%${q}%,region.ilike.%${q}%`,
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  let churches = ((data ?? []) as ChurchPublicRow[]).map(mapChurchPublic);

  if (options?.hubId?.trim()) {
    const hubId = options.hubId;
    const hubs = getRegionHubsByIds(parseHubIds(hubId));
    churches = churches.filter((c) => {
      const county = c.countyGeoid ?? null;
      if (county) {
        if (hubs.length === 1 && isUsaOverviewHub(hubs[0])) return true;
        if (hubId.includes("county:") || hubId.includes("city:")) {
          const match = countyGeoidMatchesPlaces(
            county,
            parsePlaceTokens(hubId),
          );
          if (match !== null) return match;
        }
        const allowed = hubs.flatMap((h) => [...h.countyGeoids]);
        if (allowed.length > 0) return allowed.includes(county);
      }
      return hubs.some((hub) =>
        locationFieldsMatchHub(
          {
            city: c.city,
            region: c.region,
            latitude: c.latitude,
            longitude: c.longitude,
            countyGeoid: county,
          },
          hub,
        ),
      );
    });
  }

  return churches.slice(0, limit);
}

export async function getChurchBySlug(
  client: Client,
  slug: string,
): Promise<Church | null> {
  const normalized = normalizeRouteSlug(slug);
  if (!normalized) return null;

  const { data, error } = await db(client)
    .from("churches_public")
    .select("*")
    .eq("slug", normalized)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapChurchPublic(data as ChurchPublicRow);
}

export async function getChurchOwnerBySlug(
  client: Client,
  slug: string,
): Promise<Church | null> {
  const normalized = normalizeRouteSlug(slug);
  if (!normalized) return null;

  const { data, error } = await db(client)
    .from("churches")
    .select(CHURCH_OWNER_SELECT)
    .eq("slug", normalized)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapChurchOwner(data as ChurchRow);
}

export async function getChurchOwnerById(
  client: Client,
  id: string,
): Promise<Church | null> {
  if (!id?.trim()) return null;
  const { data, error } = await db(client)
    .from("churches")
    .select(CHURCH_OWNER_SELECT)
    .eq("id", id.trim())
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapChurchOwner(data as ChurchRow);
}
