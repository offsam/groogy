/**
 * Normalize pasted Google Maps links / US street addresses into searchable parts.
 * Prevents long maps URLs from blowing the API body and AND-failing every token.
 */

export type NormalizedSearchQuery = {
  /** Text sent to the LLM / primary search pipeline. */
  query: string;
  /** Original input (clamped). */
  original: string;
  kind: "text" | "maps_url" | "address";
  placeName: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  /** Compact tokens that should match address_line / name (not CA/USA noise). */
  addressSearchTerms: string[];
};

const ADDRESS_NOISE = new Set([
  "us",
  "usa",
  "united",
  "states",
  "america",
  "ca",
  "california",
  "st",
  "street",
  "ave",
  "avenue",
  "blvd",
  "boulevard",
  "rd",
  "road",
  "dr",
  "drive",
  "ln",
  "lane",
  "ct",
  "court",
  "way",
  "pkwy",
  "parkway",
  "hwy",
  "highway",
  "suite",
  "ste",
  "unit",
  "apt",
  "floor",
  "fl",
]);

function clamp(text: string, max = 500): string {
  return text.trim().slice(0, max);
}

function decodePlus(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value.replace(/\+/g, " ");
  }
}

function looksLikeMapsUrl(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("google.com/maps") ||
    lower.includes("maps.google.") ||
    lower.includes("maps.app.goo.gl") ||
    lower.includes("goo.gl/maps")
  );
}

function extractCoords(text: string): { lat: number; lng: number } | null {
  const at = text.match(/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (at) {
    const lat = Number(at[1]);
    const lng = Number(at[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  const qll = text.match(/[?&](?:q|query)=(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/i);
  if (qll) {
    const lat = Number(qll[1]);
    const lng = Number(qll[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

function extractPlaceNameFromMapsUrl(url: string): string | null {
  const place = url.match(/\/maps\/place\/([^/@]+)/i);
  if (place?.[1]) {
    const name = decodePlus(place[1]).replace(/\s+/g, " ").trim();
    // Skip if it looks like a raw street-only blob without letters of a brand —
    // still useful as address text.
    if (name.length >= 2) return name;
  }
  return null;
}

function extractQueryParamAddress(url: string): string | null {
  try {
    const u = new URL(url);
    for (const key of ["q", "query", "destination", "daddr"]) {
      const v = u.searchParams.get(key);
      if (v?.trim()) return decodePlus(v.trim());
    }
  } catch {
    const m = url.match(/[?&](?:q|query|destination|daddr)=([^&]+)/i);
    if (m?.[1]) return decodePlus(m[1]);
  }
  return null;
}

/** Loose US mailing address: "123 Main St, Irvine, CA 92614" */
function parseUsAddress(text: string): {
  street: string | null;
  city: string | null;
  postalCode: string | null;
} | null {
  const cleaned = text
    .replace(/\s+/g, " ")
    .replace(/\bUnited States\b/gi, "")
    .replace(/\bUSA\b/gi, "")
    .trim()
    .replace(/,\s*$/, "");

  // 123 Something, City, ST 92614
  const full = cleaned.match(
    /^(\d{1,6}\s+[^,]+),\s*([^,]+),\s*([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)?\s*$/,
  );
  if (full) {
    return {
      street: full[1].trim(),
      city: full[2].trim(),
      postalCode: full[4]?.trim() ?? null,
    };
  }

  // City, ST 92614 (no street)
  const cityOnly = cleaned.match(
    /^([^,]+),\s*([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)?\s*$/,
  );
  if (cityOnly && /\d/.test(cleaned) === false) {
    return {
      street: null,
      city: cityOnly[1].trim(),
      postalCode: cityOnly[3]?.trim() ?? null,
    };
  }

  // Starts with street number — treat first comma segment as street, second as city
  if (/^\d{1,6}\s+\S+/.test(cleaned) && cleaned.includes(",")) {
    const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const zip = cleaned.match(/\b(\d{5})(?:-\d{4})?\b/);
      return {
        street: parts[0],
        city: parts[1].replace(/\b[A-Za-z]{2}\b/, "").replace(/\d{5}(?:-\d{4})?/, "").trim() ||
          parts[1],
        postalCode: zip?.[1] ?? null,
      };
    }
  }

  return null;
}

function looksLikePlainAddress(text: string): boolean {
  if (looksLikeMapsUrl(text)) return false;
  if (parseUsAddress(text)) return true;
  // Street number + street-ish word, optionally with city commas
  return /^\d{1,6}\s+[\p{L}\p{N}].{3,}/u.test(text) && /[,\s]/.test(text);
}

function distinctiveAddressTerms(parts: {
  placeName?: string | null;
  street?: string | null;
  city?: string | null;
  postalCode?: string | null;
}): string[] {
  const out: string[] = [];
  const pushTokens = (value: string | null | undefined, keepNoise = false) => {
    if (!value) return;
    for (const raw of value.split(/[^\p{L}\p{N}]+/u)) {
      const t = raw.trim().toLowerCase();
      if (t.length < 2) continue;
      if (!keepNoise && ADDRESS_NOISE.has(t)) continue;
      // Skip bare state-sized 2-letter tokens except when part of place name handling
      if (!keepNoise && /^[a-z]{2}$/.test(t)) continue;
      out.push(t);
    }
  };

  pushTokens(parts.placeName, true);
  pushTokens(parts.street);
  // Keep house number from street (highly distinctive)
  const num = parts.street?.match(/^\d{1,6}/)?.[0];
  if (num) out.unshift(num);
  pushTokens(parts.city, true);
  if (parts.postalCode && /^\d{5}/.test(parts.postalCode)) {
    out.push(parts.postalCode.slice(0, 5));
  }

  return [...new Set(out)].slice(0, 8);
}

function buildSearchQueryFromParts(parts: {
  placeName?: string | null;
  street?: string | null;
  city?: string | null;
}): string {
  if (parts.placeName && !/^\d{1,6}\s/.test(parts.placeName)) {
    // Brand/place title from Maps — best search key
    return parts.placeName;
  }
  if (parts.street) {
    // Prefer "4250 Barranca" over full "4250 Barranca Pkwy"
    const tokens = parts.street
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 2 && !ADDRESS_NOISE.has(t.toLowerCase()));
    return tokens.slice(0, 3).join(" ");
  }
  if (parts.city) return parts.city;
  return "";
}

/**
 * Turn a raw search box paste into something the catalog can actually match.
 */
export function normalizeSearchQueryInput(raw: string): NormalizedSearchQuery {
  const original = clamp(raw, 2000);
  const empty: NormalizedSearchQuery = {
    query: clamp(original, 200),
    original,
    kind: "text",
    placeName: null,
    street: null,
    city: null,
    postalCode: null,
    lat: null,
    lng: null,
    addressSearchTerms: [],
  };

  if (!original) return empty;

  if (looksLikeMapsUrl(original)) {
    const coords = extractCoords(original);
    const placeName = extractPlaceNameFromMapsUrl(original);
    const fromQ = extractQueryParamAddress(original);
    const addressSource = fromQ || (placeName && /^\d{1,6}\s/.test(placeName) ? placeName : null);
    const parsed = addressSource ? parseUsAddress(addressSource) : null;
    const street = parsed?.street ?? (addressSource && /^\d{1,6}\s/.test(addressSource) ? addressSource.split(",")[0].trim() : null);
    const city = parsed?.city ?? null;
    const postalCode = parsed?.postalCode ?? null;
    // Place path may be a business name (not a street)
    const brand =
      placeName && !/^\d{1,6}\s/.test(placeName) ? placeName : null;

    const query =
      buildSearchQueryFromParts({
        placeName: brand,
        street,
        city,
      }) ||
      (brand ?? street ?? city ?? clamp(original, 120));

    return {
      query: clamp(query, 200),
      original,
      kind: "maps_url",
      placeName: brand,
      street,
      city,
      postalCode,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      addressSearchTerms: distinctiveAddressTerms({
        placeName: brand,
        street,
        city,
        postalCode,
      }),
    };
  }

  if (looksLikePlainAddress(original)) {
    const parsed = parseUsAddress(original);
    const street = parsed?.street ?? original.split(",")[0]?.trim() ?? null;
    const city = parsed?.city ?? null;
    const postalCode = parsed?.postalCode ?? null;
    const query = buildSearchQueryFromParts({ street, city }) || clamp(original, 200);

    return {
      query: clamp(query, 200),
      original,
      kind: "address",
      placeName: null,
      street,
      city,
      postalCode,
      lat: null,
      lng: null,
      addressSearchTerms: distinctiveAddressTerms({ street, city, postalCode }),
    };
  }

  return {
    ...empty,
    query: clamp(original, 200),
  };
}
