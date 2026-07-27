export type BusinessLocationKind = "street" | "city" | "service_area";

export type BusinessLocationPrecision =
  | "street"
  | "city"
  | "county"
  | "approx";

export type BusinessLocation = {
  id: string;
  businessId: string;
  label: string | null;
  kind: BusinessLocationKind;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  stateCode: string | null;
  postalCode: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  locationPrecision: BusinessLocationPrecision | null;
  googleMapsUrl: string | null;
  isPrimary: boolean;
  sortOrder: number;
  source: string | null;
  sourceUrl: string | null;
};

export function formatBusinessLocationLine(loc: BusinessLocation): string {
  const parts: string[] = [];
  if (loc.addressLine?.trim()) parts.push(loc.addressLine.trim());
  const cityState = [loc.city, loc.stateCode?.replace(/^US-/, "") || loc.region]
    .filter(Boolean)
    .join(", ");
  if (cityState && loc.postalCode?.trim()) {
    parts.push(`${cityState} ${loc.postalCode.trim()}`);
  } else if (cityState) {
    parts.push(cityState);
  } else if (loc.label?.trim()) {
    parts.push(loc.label.trim());
  }
  return parts.join(", ");
}
