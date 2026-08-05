/** Street vs county-level location for map pins. */

export type LocationPrecision = "street" | "county";

const STREET_NUMBER_RE =
  /(^|\s)\d{1,6}\s+(?:\d{1,3}(?:st|nd|rd|th)\b|[A-Za-zА-Яа-я])/iu;

export function looksLikeStreetAddress(
  address: string | null | undefined,
): boolean {
  if (!address?.trim()) return false;
  return STREET_NUMBER_RE.test(address.trim());
}

/** True when the place text is an explicit county label (e.g. «Orange County»). */
export function looksLikeCountyLabel(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  const v = value.trim().toLowerCase().replace(/\s+/g, " ");
  // Require the word "county" so bare "Los Angeles" / "San Diego" stay city-level.
  return /\bcounty\b/.test(v);
}

export function inferLocationPrecision(input: {
  addressLine?: string | null;
  city?: string | null;
  region?: string | null;
}): LocationPrecision | null {
  if (looksLikeStreetAddress(input.addressLine)) return "street";
  if (
    looksLikeCountyLabel(input.addressLine) ||
    looksLikeCountyLabel(input.city) ||
    looksLikeCountyLabel(input.region)
  ) {
    return "county";
  }
  return null;
}
