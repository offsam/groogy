import type { CitySearchResult, UsStateOption } from "@/types/master-data";

/** Format "City, ST" for display. */
export function formatCityLabel(
  city: Pick<CitySearchResult, "name" | "stateCode"> | {
    name: string;
    stateCode?: string | null;
    abbreviation?: string | null;
  },
  states?: UsStateOption[],
): string {
  const abbr =
    "abbreviation" in city && city.abbreviation
      ? city.abbreviation
      : city.stateCode
        ? abbreviationFromStateCode(city.stateCode, states)
        : null;
  if (abbr) return `${city.name}, ${abbr}`;
  return city.name;
}

export function abbreviationFromStateCode(
  stateCode: string,
  states?: UsStateOption[],
): string {
  const fromList = states?.find((s) => s.code === stateCode)?.abbreviation;
  if (fromList) return fromList;
  if (stateCode.includes("-")) {
    const part = stateCode.split("-").pop();
    if (part) return part;
  }
  return stateCode;
}

export function stateCodeFromAbbreviation(
  abbreviationOrCode: string,
  states?: UsStateOption[],
): string | null {
  const raw = abbreviationOrCode.trim();
  if (!raw) return null;
  if (raw.startsWith("US-") || raw.includes("-")) return raw;
  const upper = raw.toUpperCase();
  const match = states?.find(
    (s) =>
      s.abbreviation.toUpperCase() === upper ||
      s.nameEn.toLowerCase() === raw.toLowerCase(),
  );
  return match?.code ?? (upper.length === 2 ? `US-${upper}` : null);
}

export type LegacyLocationInput = {
  city?: string | null;
  state?: string | null;
  stateCode?: string | null;
  cityGeoid?: string | null;
};

export type ResolvedLocation = {
  city: string | null;
  state: string | null;
  stateCode: string | null;
  cityGeoid: string | null;
  label: string | null;
};

/**
 * Prefer structured geo IDs when present; keep legacy city/state text in sync.
 */
export function resolveLegacyLocation(
  input: LegacyLocationInput,
  states?: UsStateOption[],
): ResolvedLocation {
  const city = input.city?.trim() || null;
  let stateCode = input.stateCode?.trim() || null;
  const cityGeoid = input.cityGeoid?.trim() || null;

  if (!stateCode && input.state) {
    stateCode = stateCodeFromAbbreviation(input.state, states);
  }

  const state =
    input.state?.trim() ||
    (stateCode ? abbreviationFromStateCode(stateCode, states) : null);

  const label =
    city && state
      ? `${city}, ${state}`
      : city || state || null;

  return { city, state, stateCode, cityGeoid, label };
}
