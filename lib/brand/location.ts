import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type BrandLocation,
  countyInLabel,
  normalizeUsZip,
} from "@/lib/brand";
import { resolveCountyFromLatLng } from "@/lib/regions/fcc";
import { getRegionHubByCountyGeoid } from "@/lib/regions/hubs";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

type ZipResolveResult = {
  postalCode: string;
  city: string | null;
  stateAbbr: string | null;
  stateCode: string | null;
  cityGeoid: string | null;
  countyGeoid: string | null;
  countyName: string | null;
};

function normalizePlaceName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

async function countyFromLatLng(
  client: Client,
  lat: number,
  lng: number,
): Promise<{ countyGeoid: string; countyName: string | null } | null> {
  const fcc = await resolveCountyFromLatLng(lat, lng);
  if (!fcc) return null;

  const { data: county } = await client
    .from("platform_counties")
    .select("geoid, name")
    .eq("geoid", fcc.countyGeoid)
    .maybeSingle();

  return {
    countyGeoid: fcc.countyGeoid,
    countyName: county?.name ?? fcc.countyName,
  };
}

/** Resolve US ZIP → city/state via Zippopotam, county via FCC + platform_counties. */
export async function resolveUsZipLocation(
  client: Client,
  zipRaw: string,
): Promise<ZipResolveResult | null> {
  const postalCode = normalizeUsZip(zipRaw);
  if (!postalCode) return null;

  let placeName: string | null = null;
  let stateAbbr: string | null = null;
  let lat: number | null = null;
  let lng: number | null = null;

  try {
    const res = await fetch(`https://api.zippopotam.us/us/${postalCode}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 86400 },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        places?: Array<{
          "place name"?: string;
          "state abbreviation"?: string;
          latitude?: string;
          longitude?: string;
        }>;
      };
      const place = data.places?.[0];
      placeName = place?.["place name"] ?? null;
      stateAbbr = place?.["state abbreviation"] ?? null;
      const latN = Number(place?.latitude);
      const lngN = Number(place?.longitude);
      if (Number.isFinite(latN) && Number.isFinite(lngN)) {
        lat = latN;
        lng = lngN;
      }
    }
  } catch {
    // ZIP still saved without geo
  }

  const stateCode = stateAbbr ? `US-${stateAbbr.toUpperCase()}` : null;
  let cityGeoid: string | null = null;
  let countyGeoid: string | null = null;
  let countyName: string | null = null;

  if (lat != null && lng != null) {
    const county = await countyFromLatLng(client, lat, lng);
    if (county) {
      countyGeoid = county.countyGeoid;
      countyName = county.countyName;
    }
  }

  if (placeName && stateCode) {
    const needle = normalizePlaceName(placeName);
    const { data: cities } = await client
      .from("platform_cities")
      .select(
        "geoid, name, name_normalized, primary_county_geoid, state_code, latitude, longitude",
      )
      .eq("state_code", stateCode)
      .eq("is_active", true)
      .ilike("name", `%${placeName}%`)
      .limit(25);

    const list = cities ?? [];
    const match =
      list.find(
        (c) => normalizePlaceName(c.name_normalized || c.name || "") === needle,
      ) ??
      list.find((c) => {
        const n = normalizePlaceName(c.name_normalized || c.name || "");
        return n.includes(needle) || needle.includes(n);
      });

    if (match) {
      cityGeoid = match.geoid;
      if (!countyGeoid && match.primary_county_geoid) {
        countyGeoid = match.primary_county_geoid;
      }
      if (!countyGeoid && match.latitude != null && match.longitude != null) {
        const county = await countyFromLatLng(
          client,
          Number(match.latitude),
          Number(match.longitude),
        );
        if (county) {
          countyGeoid = county.countyGeoid;
          countyName = county.countyName;
        }
      }
      if (countyGeoid && !countyName) {
        const { data: county } = await client
          .from("platform_counties")
          .select("geoid, name")
          .eq("geoid", countyGeoid)
          .maybeSingle();
        countyName = county?.name ?? null;
      }
    }
  }

  return {
    postalCode,
    city: placeName,
    stateAbbr,
    stateCode,
    cityGeoid,
    countyGeoid,
    countyName,
  };
}

export async function getBrandLocationForProfile(
  client: Client,
  profile: {
    county_geoid?: string | null;
    city_geoid?: string | null;
  } | null,
): Promise<BrandLocation | null> {
  if (!profile) return null;

  let countyGeoid = profile.county_geoid ?? null;

  if (!countyGeoid && profile.city_geoid) {
    const { data: city } = await client
      .from("platform_cities")
      .select("primary_county_geoid, latitude, longitude")
      .eq("geoid", profile.city_geoid)
      .maybeSingle();
    countyGeoid = city?.primary_county_geoid ?? null;
    if (
      !countyGeoid &&
      city?.latitude != null &&
      city?.longitude != null
    ) {
      const resolved = await countyFromLatLng(
        client,
        Number(city.latitude),
        Number(city.longitude),
      );
      countyGeoid = resolved?.countyGeoid ?? null;
    }
  }

  if (!countyGeoid) return null;

  const { data: county } = await client
    .from("platform_counties")
    .select("geoid, name")
    .eq("geoid", countyGeoid)
    .maybeSingle();

  if (!county) return null;

  const inLabel = countyInLabel(county.geoid, county.name);
  if (!inLabel) return null;

  return {
    countyGeoid: county.geoid,
    countyName: county.name,
    inLabel,
    hub: getRegionHubByCountyGeoid(county.geoid),
  };
}
