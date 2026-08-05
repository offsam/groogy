/**
 * Resolve city/region from Telegram/Facebook group names when the post
 * itself has no explicit location.
 *
 * Group matching uses the USA catalog (data/geo/source_location_groups.json).
 */

import { resolveFromSourceGroupCatalog } from "@/lib/geo/source-location-groups";
import { stateCodeFromKnownCity } from "@/lib/geo/city-aliases";

export type SourceGroupLocation = {
  /** City name when the group is city-scoped (Sacramento, LA). */
  city: string | null;
  /** County / metro when the group is area-scoped (Orange County). */
  region: string | null;
  stateCode: string;
  countyGeoid?: string | null;
  /** Hub id for filters when known. */
  hubId: string | null;
};

/**
 * Infer location from source_group / source key / chat title.
 * Returns null when the group is unknown (do not invent a city).
 */
export function resolveLocationFromSourceGroup(
  ...parts: Array<string | null | undefined>
): SourceGroupLocation | null {
  const hit = resolveFromSourceGroupCatalog(...parts);
  if (!hit) return null;
  return {
    city: hit.city,
    region: hit.region,
    stateCode: hit.stateCode,
    countyGeoid: hit.countyGeoid,
    hubId: (hit.hubId as SourceGroupLocation["hubId"]) ?? null,
  };
}

/** County-style labels that belong in `region`, not `city`. */
export function isCountyOrMetroLabel(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  const v = value.trim().toLowerCase().replace(/\s+/g, " ");
  return (
    /\bcounty\b/.test(v) ||
    v === "oc" ||
    v === "orange county" ||
    v === "оранж каунти" ||
    v === "los angeles county" ||
    v === "san diego county" ||
    v === "sacramento county" ||
    v === "san francisco county" ||
    v === "bay area" ||
    v === "southern california"
  );
}

/**
 * Infer location from free text (description / source_text).
 * Explicit place in the post beats the source-group fallback.
 */
export function resolveLocationFromText(
  text: string | null | undefined,
): SourceGroupLocation | null {
  const blob = (text || "").trim().slice(0, 2500);
  if (!blob) return null;

  const textRules: Array<{ match: RegExp; location: SourceGroupLocation }> = [
    {
      match: /\b(orange\s*county|оранж(?:\s*каунти)?|\boc\b)\b/i,
      location: {
        city: null,
        region: "Orange County",
        stateCode: "US-CA",
        countyGeoid: "06059",
        hubId: "orange-county",
      },
    },
    {
      match: /\b(sacramento|сакраменто)\b/i,
      location: {
        city: "Sacramento",
        region: "Sacramento County",
        stateCode: "US-CA",
        countyGeoid: "06067",
        hubId: "sacramento",
      },
    },
    {
      match: /\b(san\s*diego|сан[-\s]?диего)\b/i,
      location: {
        city: "San Diego",
        region: "San Diego County",
        stateCode: "US-CA",
        countyGeoid: "06073",
        hubId: "san-diego",
      },
    },
    {
      match: /\b(san\s*francisco|\bsf\b|bay\s*area|сан[-\s]?франциско)\b/i,
      location: {
        city: "San Francisco",
        region: "San Francisco County",
        stateCode: "US-CA",
        countyGeoid: "06075",
        hubId: "san-francisco",
      },
    },
    {
      match: /\b(los\s*angeles|\bla\b|лос[-\s]?анджелес\w*)\b/i,
      location: {
        city: "Los Angeles",
        region: "Los Angeles County",
        stateCode: "US-CA",
        countyGeoid: "06037",
        hubId: "los-angeles",
      },
    },
    {
      match: /\b(denver|денвер)\b/i,
      location: {
        city: "Denver",
        region: "Denver County",
        stateCode: "US-CO",
        countyGeoid: "08031",
        hubId: null,
      },
    },
    {
      match: /\b(seattle|сиэтл|сиэттл)\b/i,
      location: {
        city: "Seattle",
        region: "King County",
        stateCode: "US-WA",
        countyGeoid: "53033",
        hubId: "seattle",
      },
    },
    {
      match:
        /\b(irvine|айрвин|anaheim|santa\s*ana|tustin|costa\s*mesa|newport\s*beach|huntington\s*beach|fullerton|buena\s*park|garden\s*grove)\b/i,
      location: {
        city: null,
        region: "Orange County",
        stateCode: "US-CA",
        countyGeoid: "06059",
        hubId: "orange-county",
      },
    },
  ];

  for (const rule of textRules) {
    const m = rule.match.exec(blob);
    if (!m) continue;
    // «Irvine Blvd» is a street name, not the city of Irvine.
    const after = blob.slice(m.index + m[0].length, m.index + m[0].length + 16);
    if (
      /^\s*(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Place|Pl|Way)\b/i.test(
        after,
      )
    ) {
      continue;
    }
    const raw = m[0].replace(/\s+/g, " ").trim().toLowerCase();
    const loc = { ...rule.location };
    const ocCities: Record<string, string> = {
      irvine: "Irvine",
      айрвин: "Irvine",
      anaheim: "Anaheim",
      "santa ana": "Santa Ana",
      tustin: "Tustin",
      "costa mesa": "Costa Mesa",
      "newport beach": "Newport Beach",
      "huntington beach": "Huntington Beach",
      fullerton: "Fullerton",
      "buena park": "Buena Park",
      "garden grove": "Garden Grove",
    };
    if (loc.hubId === "orange-county" && ocCities[raw]) {
      loc.city = ocCities[raw]!;
    }
    return loc;
  }
  return null;
}

/**
 * Merge explicit post location with text mention, then group fallback.
 *
 * - Explicit real city wins when present.
 * - County labels in `city` move to `region`.
 * - Else take place from description/source_text (e.g. «Orange County»).
 * - Else fill from the source group (Russian.Sacramento → Sacramento).
 */
export function mergeLocationWithGroupFallback(input: {
  city?: string | null;
  region?: string | null;
  stateCode?: string | null;
  sourceGroup?: string | null;
  source?: string | null;
  chatId?: string | null;
  text?: string | null;
}): {
  city: string | null;
  region: string | null;
  stateCode: string | null;
  countyGeoid: string | null;
} {
  let city = input.city?.trim() || null;
  let region = input.region?.trim() || null;
  let stateCode = input.stateCode?.trim() || null;
  let countyGeoid: string | null = null;

  if (city && isCountyOrMetroLabel(city)) {
    if (!region) region = city.replace(/\boc\b/i, "Orange County");
    if (/^oc$/i.test(city.trim())) region = "Orange County";
    city = null;
  }

  const fromText = resolveLocationFromText(input.text);
  const fromGroup = resolveLocationFromSourceGroup(
    input.chatId,
    input.sourceGroup,
    input.source,
  );
  const filler = fromText || fromGroup;
  if (filler) {
    if (!city && filler.city) city = filler.city;
    // Never stamp a metro/county region that conflicts with an explicit city.
    // Example: city=Los Angeles + description mentions Irvine → do not write Orange County.
    const cityHub = city ? hubIdForCityLabel(city) : null;
    const fillerHub =
      filler.hubId ||
      (filler.region ? hubIdForRegionLabel(filler.region) : null) ||
      (filler.city ? hubIdForCityLabel(filler.city) : null);
    const hubConflict =
      Boolean(cityHub && fillerHub && cityHub !== fillerHub);

    if (!hubConflict) {
      if (!city && !region && filler.region) region = filler.region;
      if (!region && filler.region) region = filler.region;
      if (filler.countyGeoid) countyGeoid = filler.countyGeoid;
    }
    if (!stateCode) stateCode = filler.stateCode;
  }

  return {
    city,
    region,
    // Never invent California — unknown state stays null until ZIP/city/group proves it.
    stateCode: stateCode || stateCodeFromKnownCity(city) || null,
    countyGeoid,
  };
}

function hubIdForCityLabel(city: string): string | null {
  const c = city.trim().toLowerCase();
  if (
    /los\s*angeles|glendale|burbank|pasadena|santa\s*monica|west\s*hollywood|beverly\s*hills|hollywood|van\s*nuys|northridge|woodland\s*hills|long\s*beach/.test(
      c,
    )
  ) {
    return "los-angeles";
  }
  if (
    /irvine|anaheim|santa\s*ana|costa\s*mesa|huntington\s*beach|newport|fullerton|garden\s*grove|westminster|tustin|laguna|mission\s*viejo|orange\s*county|^oc$/.test(
      c,
    )
  ) {
    return "orange-county";
  }
  if (/sacramento|roseville|elk\s*grove|citrus\s*heights|folsom/.test(c)) {
    return "sacramento";
  }
  if (/san\s*francisco|oakland|berkeley|san\s*jose|palo\s*alto|bay\s*area/.test(c)) {
    return "san-francisco";
  }
  if (/san\s*diego|chula\s*vista|la\s*jolla|carlsbad/.test(c)) {
    return "san-diego";
  }
  return null;
}

function hubIdForRegionLabel(region: string): string | null {
  const r = region.trim().toLowerCase();
  if (/orange\s*county|^oc$/.test(r)) return "orange-county";
  if (/los\s*angeles/.test(r)) return "los-angeles";
  if (/sacramento/.test(r)) return "sacramento";
  if (/san\s*francisco|bay\s*area/.test(r)) return "san-francisco";
  if (/san\s*diego/.test(r)) return "san-diego";
  return null;
}

/**
 * When a listing was geocoded into the wrong metro, prefer the source-group hub.
 * Returns null when there is no conflict / no source signal.
 */
export function sourceHubCorrection(input: {
  sourceUrl?: string | null;
  sourceGroup?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): SourceGroupLocation | null {
  const fromGroup = resolveLocationFromSourceGroup(
    input.sourceUrl,
    input.sourceGroup,
  );
  if (!fromGroup?.hubId) return null;

  const city = (input.city || "").trim().toLowerCase();
  const foreignCity =
    (fromGroup.hubId === "sacramento" &&
      /buena park|irvine|anaheim|costa mesa|tustin|los angeles|glendale/.test(
        city,
      )) ||
    (fromGroup.hubId === "san-francisco" &&
      /anaheim|chula vista|san diego|buena park|irvine/.test(city)) ||
    (fromGroup.hubId === "los-angeles" &&
      /sacramento|roseville|san diego|chula vista/.test(city));

  if (foreignCity) return fromGroup;
  if (!city && fromGroup.city) return fromGroup;
  return null;
}
