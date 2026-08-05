import "server-only";

/**
 * Address → geo step for platform write paths (enrich, publish).
 *
 * Mirrors `scripts/business-enrich/address_geo.py`: a street-looking string is
 * not a pin. `location_precision = 'street'` may only be stored together with
 * coordinates, otherwise the card shows a city map instead of a fake pin.
 */

import { normalizeStructuredAddress } from "@/lib/address/normalize";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const UA = "KrugiGeoStep/1.0 (catalog; contact@krugi.app)";

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii",
  ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming",
};

const UNIT_RE =
  /,?\s*\b(?:ste|suite|unit|apt|apartment|bldg|building|fl|floor|room|rm|office)\b\.?\s*#?\s*(?:(?=[\w-]*\d)[\w-]{1,8}|[A-Za-z]{1,2})\b/gi;

/** Directory typos that send Nominatim to the wrong city (McArthur → Inland Empire). */
const STREET_SPELLING_FIXES: Array<[RegExp, string]> = [
  [/\bMcArthur\b/gi, "MacArthur"],
  [/\bMcarthur\b/gi, "MacArthur"],
];

export type StreetGeo = {
  latitude: number;
  longitude: number;
  /** ZIP reported by the geocoder, only when the card had none. */
  postalCode: string | null;
};

export function stateAbbr(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const upper = value.toUpperCase().replace(/^US-/, "");
  if (STATE_NAMES[upper]) return upper;
  const byName = Object.entries(STATE_NAMES).find(
    ([, name]) => name.toLowerCase() === value.toLowerCase(),
  );
  return byName?.[0] ?? null;
}

function isCountyLabel(value: string | null | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "oc" || v.endsWith(" county");
}

/** House number + street name — the only shape that earns a street pin. */
export function looksLikeStreetAddress(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  if (!v || isCountyLabel(v)) return false;
  // «1800 County Road 42 EAST» / «500 Hwy 99» — type before route number.
  if (
    /^\d{1,6}\s+(?:County\s+(?:Road|Rd)|CR|State\s+(?:Route|Hwy|Highway|Rd|Road)|SR|US\s*(?:Hwy|Highway)|(?:State\s+)?(?:Hwy|Highway)|Interstate|I-?)\s*\d+/i.test(
      v,
    )
  ) {
    return true;
  }
  // «123 Main St» or «18635 8th Ave S» (ordinal street names start with a digit).
  if (
    !/^\d{1,6}\s+(?:\d{1,3}(?:st|nd|rd|th)\b|[A-Za-zА-Яа-я])/i.test(v)
  ) {
    return false;
  }
  return !/^\d{1,6}\s+\d+\s*$/.test(v);
}

/** Directory glue: «6108 seattleubc.com 1829 S 308th St» / «4 ufgpc.com 5904…» */
const DOMAIN_GLUE_RE =
  /(?:\b\d{1,6}\s+)?[\w.-]+\.(?:com|org|net|ru|info|us)\s+/gi;

/** Strip website crumbs pasted in front of the real street line. */
export function scrubDirectoryGlue(
  value: string | null | undefined,
): string {
  const v = (value ?? "").replace(/\s+/g, " ").trim();
  if (!v) return "";
  const cleaned = v.replace(DOMAIN_GLUE_RE, "").replace(/^[,;\-\s]+|[,;\-\s]+$/g, "");
  return cleaned || v;
}

/** Drop «Ste 200» / «#5» / «Apt B» — unit numbers confuse the geocoder. */
function stripUnit(value: string): string {
  return value
    .replace(UNIT_RE, "")
    .replace(/#\s*[\w-]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,\s-]+|[,\s-]+$/g, "");
}

function normalizeStreetSpelling(value: string): string {
  let v = value.replace(/\s+/g, " ").trim();
  for (const [pat, repl] of STREET_SPELLING_FIXES) {
    v = v.replace(pat, repl);
  }
  return v;
}

function normPlace(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hitMatchesExpected(
  hit: {
    postalCode: string | null;
    places: string[];
  },
  expectCity: string | null,
  expectPostal: string | null,
): boolean {
  const expectZip = (expectPostal ?? "").replace(/\D/g, "").slice(0, 5);
  const hitZip = (hit.postalCode ?? "").replace(/\D/g, "").slice(0, 5);

  const city = normPlace(expectCity);
  const places = hit.places.map(normPlace).filter(Boolean);
  const cityOk =
    !city ||
    isCountyLabel(expectCity) ||
    places.some(
      (p) => p === city || p.includes(city) || city.includes(p),
    );

  if (expectZip.length === 5) {
    if (hitZip === expectZip) return true;
    // OSM often stamps a neighboring ZIP on the same building (92592 vs 92591).
    // Prefer city match over a hard ZIP reject so street pins still land.
    if (hitZip && hitZip !== expectZip) {
      return cityOk && Boolean(city) && !isCountyLabel(expectCity);
    }
  }

  if (!city || isCountyLabel(expectCity)) return true;
  if (!places.length) return !expectZip;
  return cityOk;
}

function buildQuery(
  street: string,
  city: string | null,
  stateCode: string | null,
  postalCode: string | null,
): string {
  const blob = street.toLowerCase();
  const parts = [street];
  if (city && !isCountyLabel(city) && !blob.includes(city.toLowerCase())) {
    parts.push(city.trim());
  }
  const abbr = stateAbbr(stateCode);
  if (abbr) parts.push(STATE_NAMES[abbr]);
  if (postalCode?.trim() && !blob.includes(postalCode.trim())) {
    parts.push(postalCode.trim());
  }
  parts.push("USA");
  return parts.filter(Boolean).join(", ");
}

export function googleMapsUrlForAddress(
  street: string,
  city: string | null | undefined,
  stateCode: string | null | undefined,
): string {
  const query = [street, city, stateAbbr(stateCode)]
    .filter((p): p is string => Boolean(p) && !isCountyLabel(p))
    .join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

async function lookup(
  query: string,
  expectState: string | null,
  expectCity: string | null,
  expectPostal: string | null,
): Promise<StreetGeo | null> {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: "5",
    countrycodes: "us",
    addressdetails: "1",
  });
  let rows: unknown;
  try {
    const res = await fetch(`${NOMINATIM}?${params}`, {
      headers: { "User-Agent": UA },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    rows = await res.json();
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;

  for (const row of rows as Array<Record<string, unknown>>) {
    const address = (row.address ?? {}) as Record<string, string | undefined>;
    if (expectState) {
      const found = (address.state ?? "").trim();
      if (found && found !== STATE_NAMES[expectState]) continue;
    }
    const latitude = Number(row.lat);
    const longitude = Number(row.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const zip = (address.postcode ?? "").trim();
    const postalCode = /^\d{5}/.test(zip) ? zip.slice(0, 5) : null;
    const places = [
      address.city,
      address.town,
      address.village,
      address.municipality,
      address.suburb,
      address.hamlet,
      address.county,
    ].filter((p): p is string => Boolean(p?.trim()));
    if (
      !hitMatchesExpected(
        { postalCode, places },
        expectCity,
        expectPostal,
      )
    ) {
      continue;
    }
    return {
      latitude,
      longitude,
      postalCode,
    };
  }
  return null;
}

/**
 * Geocode a street address. `attempts: "single"` keeps interactive actions fast;
 * "ladder" also retries without the unit number and without the city name.
 */
export async function geocodeStreetAddress(
  input: {
    addressLine: string | null | undefined;
    city?: string | null;
    stateCode?: string | null;
    postalCode?: string | null;
  },
  opts: { attempts?: "single" | "ladder" } = {},
): Promise<StreetGeo | null> {
  const scrubbed = scrubDirectoryGlue(input.addressLine);
  const raw = scrubbed.replace(/\s+/g, " ").trim();
  const street = normalizeStreetSpelling(raw);
  if (!looksLikeStreetAddress(street)) return null;

  const city = input.city?.trim() || null;
  const stateCode = input.stateCode?.trim() || null;
  const postalCode = input.postalCode?.trim() || null;
  const expectState = stateAbbr(stateCode);

  const queries = [buildQuery(street, city, stateCode, postalCode)];
  if (raw && raw !== street) {
    queries.unshift(buildQuery(raw, city, stateCode, postalCode));
  }
  if (opts.attempts === "ladder") {
    const bare = stripUnit(street);
    if (bare && bare !== street) {
      queries.push(buildQuery(bare, city, stateCode, postalCode));
    }
    // Drop city only while keeping ZIP — stops McArthur → Inland Empire.
    if (postalCode) {
      queries.push(buildQuery(bare || street, null, stateCode, postalCode));
    } else if (city) {
      queries.push(buildQuery(bare || street, null, stateCode, null));
    }
  }

  const seen = new Set<string>();
  for (const query of queries) {
    if (!query || seen.has(query)) continue;
    seen.add(query);
    const hit = await lookup(query, expectState, city, postalCode);
    if (hit) return hit;
  }
  return null;
}

export type StreetGeoFields = {
  latitude: number | null;
  longitude: number | null;
  /** Street only with coords; never claim street without a pin. */
  location_precision: "street" | "county" | null;
  google_maps_url?: string;
  /** Nominatim ZIP when the card had none. */
  postalCode?: string | null;
  /**
   * Scrubbed street when directory glue was removed from the input.
   * Callers should persist this so the next geocode does not re-parse junk.
   */
  addressLine?: string | null;
};

/**
 * Address write → map pin. Call on every path that changes street/city/ZIP
 * so the mini-map does not keep a stale pin after the address moves.
 */
export async function resolveStreetGeoFields(input: {
  addressLine: string | null | undefined;
  city?: string | null;
  stateCode?: string | null;
  postalCode?: string | null;
  region?: string | null;
}): Promise<StreetGeoFields> {
  const raw = (input.addressLine ?? "").replace(/\s+/g, " ").trim() || null;
  const scrubbed = scrubDirectoryGlue(raw) || null;
  const street = scrubbed;
  if (!street || !looksLikeStreetAddress(street)) {
    const region = input.region?.trim() || null;
    const city = input.city?.trim() || null;
    const county =
      isCountyLabel(street) || isCountyLabel(city) || isCountyLabel(region);
    return {
      latitude: null,
      longitude: null,
      location_precision: county ? "county" : null,
      addressLine: scrubbed && scrubbed !== raw ? scrubbed : undefined,
    };
  }

  const geo = await geocodeStreetAddress(
    {
      addressLine: street,
      city: input.city,
      stateCode: input.stateCode,
      postalCode: input.postalCode,
    },
    { attempts: "ladder" },
  );
  if (geo) {
    return {
      latitude: geo.latitude,
      longitude: geo.longitude,
      location_precision: "street",
      google_maps_url: googleMapsUrlForAddress(
        street,
        input.city,
        input.stateCode,
      ),
      postalCode: geo.postalCode,
      addressLine: scrubbed && scrubbed !== raw ? scrubbed : undefined,
    };
  }

  // Keep address text; clear stale coords until a later enrich succeeds.
  return {
    latitude: null,
    longitude: null,
    location_precision: null,
    addressLine: scrubbed && scrubbed !== raw ? scrubbed : undefined,
  };
}

export type CleanedAdminStreet = {
  addressLine: string | null;
  city: string | null;
  stateCode: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  locationPrecision: StreetGeoFields["location_precision"];
  googleMapsUrl?: string;
  /** True when scrub / peel / geo changed anything vs the input. */
  changed: boolean;
};

/**
 * Admin enrich / paste: scrub directory glue, peel City/ST/ZIP out of the
 * street dump, optionally geocode. Use `withGeo` when the table has lat/lng
 * (recommendations, live cards). Import-review queue has no coords — scrub only.
 */
export async function cleanAdminStreetAddress(
  input: {
    addressLine?: string | null;
    city?: string | null;
    stateCode?: string | null;
    postalCode?: string | null;
  },
  opts: { withGeo?: boolean } = {},
): Promise<CleanedAdminStreet> {
  const rawIn = (input.addressLine ?? "").replace(/\s+/g, " ").trim() || null;
  const cityIn = input.city?.trim() || null;
  const stateIn = input.stateCode?.trim() || null;
  const zipIn = input.postalCode?.trim() || null;

  if (!rawIn) {
    return {
      addressLine: null,
      city: cityIn,
      stateCode: stateIn,
      postalCode: zipIn,
      latitude: null,
      longitude: null,
      locationPrecision: null,
      changed: false,
    };
  }

  const scrubbed = scrubDirectoryGlue(rawIn) || rawIn;
  const norm = normalizeStructuredAddress({
    addressLine: scrubbed,
    city: cityIn,
    stateCode: stateIn,
    postalCode: zipIn,
  });

  let addressLine = norm.addressLine;
  const city = norm.city;
  const stateCode = norm.stateCode;
  let postalCode = norm.postalCode;
  let latitude: number | null = null;
  let longitude: number | null = null;
  let locationPrecision: StreetGeoFields["location_precision"] = null;
  let googleMapsUrl: string | undefined;

  if (opts.withGeo && addressLine) {
    const geo = await resolveStreetGeoFields({
      addressLine,
      city,
      stateCode,
      postalCode,
    });
    latitude = geo.latitude;
    longitude = geo.longitude;
    locationPrecision = geo.location_precision;
    googleMapsUrl = geo.google_maps_url;
    if (geo.addressLine) addressLine = geo.addressLine;
    if (!postalCode && geo.postalCode) postalCode = geo.postalCode;
  }

  const changed =
    addressLine !== rawIn ||
    city !== cityIn ||
    stateCode !== stateIn ||
    postalCode !== zipIn ||
    Boolean(opts.withGeo && latitude != null);

  return {
    addressLine,
    city,
    stateCode,
    postalCode,
    latitude,
    longitude,
    locationPrecision,
    googleMapsUrl,
    changed,
  };
}
