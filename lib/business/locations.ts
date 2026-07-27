import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessLocation } from "@/types/business-location";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

function db(client: Client) {
  return client as unknown as SupabaseClient;
}

type LocationRow = {
  id: string;
  business_id: string;
  label: string | null;
  kind: BusinessLocation["kind"];
  address_line: string | null;
  city: string | null;
  region: string | null;
  state_code: string | null;
  postal_code: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  location_precision: BusinessLocation["locationPrecision"];
  google_maps_url: string | null;
  is_primary: boolean;
  sort_order: number;
  source: string | null;
  source_url: string | null;
};

const SELECT =
  "id, business_id, label, kind, address_line, city, region, state_code, postal_code, phone, latitude, longitude, location_precision, google_maps_url, is_primary, sort_order, source, source_url";

export function mapBusinessLocation(row: LocationRow): BusinessLocation {
  return {
    id: row.id,
    businessId: row.business_id,
    label: row.label,
    kind: row.kind,
    addressLine: row.address_line,
    city: row.city,
    region: row.region,
    stateCode: row.state_code,
    postalCode: row.postal_code,
    phone: row.phone,
    latitude: row.latitude,
    longitude: row.longitude,
    locationPrecision: row.location_precision,
    googleMapsUrl: row.google_maps_url,
    isPrimary: row.is_primary,
    sortOrder: row.sort_order,
    source: row.source,
    sourceUrl: row.source_url,
  };
}

export async function listPublishedBusinessLocations(
  client: Client,
  businessId: string,
): Promise<BusinessLocation[]> {
  const { data, error } = await db(client)
    .from("business_locations")
    .select(SELECT)
    .eq("business_id", businessId)
    .eq("status", "published")
    .order("is_primary", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("city", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as LocationRow[]).map(mapBusinessLocation);
}
