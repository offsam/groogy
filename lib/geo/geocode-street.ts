import "server-only";

/**
 * Address → geo step for platform write paths (enrich, publish).
 *
 * Mirrors `scripts/business-enrich/address_geo.py`: a street-looking string is
 * not a pin. `location_precision = 'street'` may only be stored together with
 * coordinates, otherwise the card shows a city map instead of a fake pin.
 */

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
  if (!/^\d{1,6}\s+[A-Za-zА-Яа-я]/.test(v)) return false;
  return !/^\d{1,6}\s+\d+\s*$/.test(v);
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
): Promise<StreetGeo | null> {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: "3",
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
    return {
      latitude,
      longitude,
      postalCode: /^\d{5}$/.test(zip) ? zip : null,
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
  const street = (input.addressLine ?? "").replace(/\s+/g, " ").trim();
  if (!looksLikeStreetAddress(street)) return null;

  const city = input.city?.trim() || null;
  const stateCode = input.stateCode?.trim() || null;
  const postalCode = input.postalCode?.trim() || null;
  const expectState = stateAbbr(stateCode);

  const queries = [buildQuery(street, city, stateCode, postalCode)];
  if (opts.attempts === "ladder") {
    const bare = stripUnit(street);
    if (bare && bare !== street) {
      queries.push(buildQuery(bare, city, stateCode, postalCode));
    }
    if (postalCode) {
      queries.push(buildQuery(bare || street, null, stateCode, postalCode));
    }
    // Typo cities break Nominatim — always retry without city.
    if (city) {
      queries.push(buildQuery(bare || street, null, stateCode, postalCode));
      queries.push(buildQuery(bare || street, null, stateCode, null));
    }
  }

  const seen = new Set<string>();
  for (const query of queries) {
    if (!query || seen.has(query)) continue;
    seen.add(query);
    const hit = await lookup(query, expectState);
    if (hit) return hit;
  }
  return null;
}
