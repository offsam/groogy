/** Product brand: КРУГИ (localized by user's county / ZIP / geo). */

import {
  getRegionHubByCountyGeoid,
  type RegionHub,
} from "@/lib/regions/hubs";

export const BRAND_NAME = "КРУГИ";

/** Logo mark path (pin with K). */
export const BRAND_MARK_SRC = "/brand/krugi-mark-256.png";
export const BRAND_MARK_FULL_SRC = "/brand/krugi-mark.png";

/**
 * Palette from the official pin logo.
 * Warm arc (yellow→orange→red), green wedge, blue chevron.
 */
export const BRAND_COLORS = {
  yellow: "#F5C400",
  orange: "#F08A1A",
  red: "#E23B2F",
  green: "#3FAF3A",
  greenDeep: "#2E8B2C",
  blue: "#1F6FE5",
  blueDeep: "#1557C0",
} as const;

/** Fallback «в …» for counties not yet mapped to a hub. */
const COUNTY_IN_LABELS: Record<string, string> = {
  "06037": "Лос-Анджелесе",
  "06059": "Оранж Каунти",
  "06065": "Риверсайд",
  "06071": "Сан-Бернардино",
  "06073": "Сан-Диего",
  "06029": "Керн",
  "06111": "Вентура",
  "36061": "Нью-Йорке",
  "36047": "Бруклине",
  "36081": "Квинсе",
  "41051": "Портленде",
};

export type BrandLocation = {
  countyGeoid: string;
  countyName: string;
  /** Phrase after «в», e.g. «Оранж Каунти» */
  inLabel: string;
  hub?: RegionHub | null;
};

export function countyInLabel(
  countyGeoid: string | null | undefined,
  countyName: string | null | undefined,
): string | null {
  const hub = getRegionHubByCountyGeoid(countyGeoid);
  if (hub) return hub.inLabel;
  if (countyGeoid && COUNTY_IN_LABELS[countyGeoid]) {
    return COUNTY_IN_LABELS[countyGeoid];
  }
  if (!countyName) return null;
  const stripped = countyName.replace(/\s+County$/i, "").trim();
  return stripped || countyName;
}

export function formatBrandHeadline(location: BrandLocation | null): {
  title: string;
  subtitle: string | null;
} {
  if (!location?.inLabel) {
    return { title: BRAND_NAME, subtitle: null };
  }
  return {
    title: BRAND_NAME,
    subtitle: `в ${location.inLabel}`,
  };
}

export function formatBrandInline(location: BrandLocation | null): string {
  if (!location?.inLabel) return BRAND_NAME;
  return `${BRAND_NAME} в ${location.inLabel}`;
}

export function formatDocumentTitle(page?: string | null): string {
  if (!page) return BRAND_NAME;
  return `${page} — ${BRAND_NAME}`;
}

export function normalizeUsZip(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 5) return null;
  return digits.slice(0, 5);
}
