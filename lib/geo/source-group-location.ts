/**
 * Resolve city/region from Telegram/Facebook group names when the post
 * itself has no explicit location.
 */

export type SourceGroupLocation = {
  /** City name when the group is city-scoped (Sacramento, LA). */
  city: string | null;
  /** County / metro when the group is area-scoped (Orange County). */
  region: string | null;
  stateCode: string;
  /** Hub id for filters when known. */
  hubId:
    | "orange-county"
    | "los-angeles"
    | "san-diego"
    | "sacramento"
    | "san-francisco"
    | null;
};

type Rule = {
  match: RegExp;
  location: SourceGroupLocation;
};

const RULES: Rule[] = [
  {
    match: /la[_\s-]?orange\s*county|orange\s*county|orangecounty|\boc\b|fun\s*for\s*mom/i,
    location: {
      city: null,
      region: "Orange County",
      stateCode: "US-CA",
      hubId: "orange-county",
    },
  },
  {
    match: /los\s*angeles|\bla\b|russian\.?la|full_group|glendale/i,
    location: {
      city: "Los Angeles",
      region: "Los Angeles County",
      stateCode: "US-CA",
      hubId: "los-angeles",
    },
  },
  {
    match: /sacramento|russian\.?sacramento|сакраменто/i,
    location: {
      city: "Sacramento",
      region: "Sacramento County",
      stateCode: "US-CA",
      hubId: "sacramento",
    },
  },
  {
    match: /san\s*diego|sandiego/i,
    location: {
      city: "San Diego",
      region: "San Diego County",
      stateCode: "US-CA",
      hubId: "san-diego",
    },
  },
  {
    match: /san\s*francisco|\bsf\b|bay\s*area|russiansf|сан[\s-]?франциско/i,
    location: {
      city: "San Francisco",
      region: "San Francisco County",
      stateCode: "US-CA",
      hubId: "san-francisco",
    },
  },
];

/**
 * Infer location from source_group / source key / chat title.
 * Returns null when the group is unknown (do not invent a city).
 */
export function resolveLocationFromSourceGroup(
  ...parts: Array<string | null | undefined>
): SourceGroupLocation | null {
  const blob = parts.filter(Boolean).join(" ").trim();
  if (!blob) return null;
  for (const rule of RULES) {
    if (rule.match.test(blob)) return { ...rule.location };
  }
  return null;
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
    v === "bay area"
  );
}

/**
 * Merge explicit post location with group fallback.
 *
 * - Explicit real city wins when present.
 * - County labels in `city` move to `region`.
 * - If there is no city (street-only post), fill city/region from the
 *   source group (Russian.Sacramento → Sacramento, etc.).
 */
export function mergeLocationWithGroupFallback(input: {
  city?: string | null;
  region?: string | null;
  stateCode?: string | null;
  sourceGroup?: string | null;
  source?: string | null;
}): {
  city: string | null;
  region: string | null;
  stateCode: string | null;
} {
  let city = input.city?.trim() || null;
  let region = input.region?.trim() || null;
  let stateCode = input.stateCode?.trim() || null;

  // "Orange County" typed as city → move to region (before group fill)
  if (city && isCountyOrMetroLabel(city)) {
    if (!region) region = city.replace(/\boc\b/i, "Orange County");
    if (/^oc$/i.test(city.trim())) region = "Orange County";
    city = null;
  }

  const fromGroup = resolveLocationFromSourceGroup(
    input.sourceGroup,
    input.source,
  );
  if (fromGroup) {
    // Street-only / missing city → take the group's city (Sacramento, LA, …)
    if (!city && fromGroup.city) city = fromGroup.city;
    if (!region && fromGroup.region) region = fromGroup.region;
    if (!stateCode) stateCode = fromGroup.stateCode;
  }

  return {
    city,
    region,
    stateCode: stateCode || (city || region ? "US-CA" : null),
  };
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

  // Defer to hubs mapBounds via dynamic import avoidance — lightweight check:
  // if city clearly belongs to another known metro, treat as conflict.
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
