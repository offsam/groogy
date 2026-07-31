/**
 * USA Location Canon — resolve county_geoid for an entity.
 * Ladder: ZIP → city+state → coordinates → source group.
 * SoT: docs/architecture/runtime/USA_LOCATION_CANON_V1.md
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeUsZip } from "@/lib/brand";
import { resolveUsZipLocation } from "@/lib/brand/location";
import {
  cityFromFreeText,
  normalizeCityLabel,
} from "@/lib/geo/city-aliases";
import { isCountyOrMetroLabel } from "@/lib/geo/source-group-location";
import { resolveFromSourceGroupCatalog } from "@/lib/geo/source-location-groups";
import { resolveCountyFromLatLng } from "@/lib/regions/fcc";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type LocationSource =
  | "zip"
  | "city"
  | "coordinates"
  | "source_group"
  | "manual";

export type LocationConfidence = "exact" | "inferred";

export type ResolvedEntityLocation = {
  city: string | null;
  region: string | null;
  stateCode: string | null;
  postalCode: string | null;
  countyGeoid: string;
  cityGeoid: string | null;
  locationSource: LocationSource;
  locationConfidence: LocationConfidence;
};

export type UnresolvedEntityLocation = {
  unresolved: true;
  reason: string;
  city: string | null;
  region: string | null;
  stateCode: string | null;
  postalCode: string | null;
};

export type EntityLocationResult =
  | ResolvedEntityLocation
  | UnresolvedEntityLocation;

export function isResolvedLocation(
  result: EntityLocationResult,
): result is ResolvedEntityLocation {
  return !("unresolved" in result && result.unresolved);
}

function normalizePlaceName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizeStateCode(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (/^US-[A-Z]{2}$/i.test(v)) return v.toUpperCase();
  if (/^[A-Z]{2}$/i.test(v)) return `US-${v.toUpperCase()}`;
  const names: Record<string, string> = {
    california: "US-CA",
    калифорния: "US-CA",
    washington: "US-WA",
    oregon: "US-OR",
    colorado: "US-CO",
    texas: "US-TX",
    florida: "US-FL",
    illinois: "US-IL",
    "new york": "US-NY",
    massachusetts: "US-MA",
    minnesota: "US-MN",
    pennsylvania: "US-PA",
    georgia: "US-GA",
    nevada: "US-NV",
    arizona: "US-AZ",
  };
  return names[v.toLowerCase()] ?? null;
}

async function lookupCity(
  client: Client,
  city: string,
  stateCode: string | null,
): Promise<{
  city: string;
  cityGeoid: string;
  countyGeoid: string | null;
  stateCode: string;
  region: string | null;
} | null> {
  const needle = normalizePlaceName(city);
  if (!needle) return null;

  let query = client
    .from("platform_cities")
    .select(
      "geoid, name, name_normalized, primary_county_geoid, state_code, latitude, longitude",
    )
    .eq("is_active", true)
    .limit(40);

  if (stateCode) {
    query = query.eq("state_code", stateCode);
  }

  const { data } = await query.ilike("name", `%${city.slice(0, 40)}%`);
  const list = data ?? [];
  const match =
    list.find(
      (c) => normalizePlaceName(c.name_normalized || c.name || "") === needle,
    ) ??
    list.find((c) => {
      const n = normalizePlaceName(c.name_normalized || c.name || "");
      return n === needle || n.startsWith(needle) || needle.startsWith(n);
    });

  if (!match) return null;

  let countyGeoid = match.primary_county_geoid ?? null;
  let region: string | null = null;
  if (countyGeoid) {
    const { data: county } = await client
      .from("platform_counties")
      .select("name")
      .eq("geoid", countyGeoid)
      .maybeSingle();
    region = county?.name ?? null;
  } else if (match.latitude != null && match.longitude != null) {
    const fcc = await resolveCountyFromLatLng(
      Number(match.latitude),
      Number(match.longitude),
    );
    if (fcc) {
      countyGeoid = fcc.countyGeoid;
      region = fcc.countyName;
    }
  }

  return {
    city: match.name,
    cityGeoid: match.geoid,
    countyGeoid,
    stateCode: match.state_code,
    region,
  };
}

export type ResolveEntityLocationInput = {
  postalCode?: string | null;
  city?: string | null;
  region?: string | null;
  stateCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  sourceGroup?: string | null;
  source?: string | null;
  chatId?: string | null;
  text?: string | null;
  /** Explicit admin override */
  countyGeoid?: string | null;
  locationSource?: LocationSource | null;
};

/**
 * Resolve county + cleaned city/region. Does not invent a city for county-scoped groups.
 */
export async function resolveEntityLocation(
  client: Client,
  input: ResolveEntityLocationInput,
): Promise<EntityLocationResult> {
  // «TX» / «USA» in the city column is a source artefact, not a city.
  let city = normalizeCityLabel(input.city);
  let region = input.region?.trim() || null;
  let stateCode = normalizeStateCode(input.stateCode);
  const postalCode = normalizeUsZip(input.postalCode ?? "") || null;

  if (city && isCountyOrMetroLabel(city)) {
    if (!region) region = city;
    city = null;
  }

  // Nothing usable in the columns — the copy often names the city itself.
  if (!city) {
    const fromText = cityFromFreeText(input.text);
    if (fromText && (!stateCode || stateCode === fromText.stateCode)) {
      city = fromText.city;
      stateCode = stateCode || fromText.stateCode;
    }
  }

  // Manual override already has county
  if (input.countyGeoid && /^\d{5}$/.test(input.countyGeoid)) {
    if (!region) {
      const { data: county } = await client
        .from("platform_counties")
        .select("name, state_code")
        .eq("geoid", input.countyGeoid)
        .maybeSingle();
      region = county?.name ?? region;
      stateCode = stateCode || county?.state_code || null;
    }
    return {
      city,
      region,
      stateCode,
      postalCode,
      countyGeoid: input.countyGeoid,
      cityGeoid: null,
      locationSource: input.locationSource ?? "manual",
      locationConfidence: "exact",
    };
  }

  // 1) ZIP
  if (postalCode) {
    const zip = await resolveUsZipLocation(client, postalCode);
    if (zip?.countyGeoid) {
      return {
        city: city || zip.city,
        region: region || zip.countyName,
        stateCode: stateCode || zip.stateCode,
        postalCode: zip.postalCode,
        countyGeoid: zip.countyGeoid,
        cityGeoid: zip.cityGeoid,
        locationSource: "zip",
        locationConfidence: "exact",
      };
    }
  }

  // 2) City + state (or city alone if unique enough via platform_cities)
  if (city && !isCountyOrMetroLabel(city)) {
    const hit = await lookupCity(client, city, stateCode);
    if (hit?.countyGeoid) {
      // City's county wins over a stale default (e.g. Sacramento + «Orange County»).
      return {
        city: hit.city,
        region: hit.region || region,
        stateCode: hit.stateCode || stateCode,
        postalCode,
        countyGeoid: hit.countyGeoid,
        cityGeoid: hit.cityGeoid,
        locationSource: "city",
        locationConfidence: stateCode ? "exact" : "inferred",
      };
    }
  }

  // 3) Coordinates
  const lat = input.latitude;
  const lng = input.longitude;
  if (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    const fcc = await resolveCountyFromLatLng(lat, lng);
    if (fcc?.countyGeoid) {
      return {
        city,
        region: region || fcc.countyName,
        stateCode: stateCode || fcc.stateCode,
        postalCode,
        countyGeoid: fcc.countyGeoid,
        cityGeoid: null,
        locationSource: "coordinates",
        locationConfidence: "exact",
      };
    }
  }

  // 4) Source group catalog
  const fromGroup = resolveFromSourceGroupCatalog(
    input.chatId,
    input.sourceGroup,
    input.source,
  );
  if (fromGroup) {
    return {
      city: city || fromGroup.city,
      // Source-group county beats a leftover hub default on the row.
      region: fromGroup.region || region,
      stateCode: stateCode || fromGroup.stateCode,
      postalCode,
      countyGeoid: fromGroup.countyGeoid,
      cityGeoid: null,
      locationSource: "source_group",
      locationConfidence: "inferred",
    };
  }

  return {
    unresolved: true,
    reason:
      "location_unresolved: нужен ZIP, город+штат, адрес или известная группа",
    city,
    region,
    stateCode,
    postalCode,
  };
}
