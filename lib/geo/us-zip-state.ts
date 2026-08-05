/**
 * Coarse USPS ZIP3 → state. Used when a hub-default state (often US-CA)
 * disagrees with the postal code so city maps / geocodes can recover.
 * Prefer Zippopotam when a network lookup is already happening.
 */

import { stateCodeFromKnownCity } from "@/lib/geo/city-aliases";

const ZIP3_RANGES: Array<[number, number, string]> = [
  [5, 5, "NY"],
  [6, 9, "PR"],
  [10, 27, "NY"],
  [28, 29, "RI"],
  [30, 38, "NH"],
  [39, 49, "ME"],
  [50, 59, "VT"],
  [60, 69, "CT"],
  [70, 89, "NJ"],
  [100, 149, "NY"],
  [150, 196, "PA"],
  [197, 199, "DE"],
  [200, 205, "DC"],
  [206, 219, "MD"],
  [220, 246, "VA"],
  [247, 268, "WV"],
  [270, 289, "NC"],
  [290, 299, "SC"],
  [300, 319, "GA"],
  [320, 349, "FL"],
  [350, 369, "AL"],
  [370, 385, "TN"],
  [386, 397, "MS"],
  [398, 399, "GA"],
  [400, 427, "KY"],
  [430, 458, "OH"],
  [460, 479, "IN"],
  [480, 499, "MI"],
  [500, 528, "IA"],
  [530, 549, "WI"],
  [550, 567, "MN"],
  [570, 577, "SD"],
  [580, 588, "ND"],
  [590, 599, "MT"],
  [600, 629, "IL"],
  [630, 658, "MO"],
  [660, 679, "KS"],
  [680, 693, "NE"],
  [700, 714, "LA"],
  [716, 729, "AR"],
  [730, 749, "OK"],
  [750, 799, "TX"],
  [800, 816, "CO"],
  [820, 831, "WY"],
  [832, 838, "ID"],
  [840, 847, "UT"],
  [850, 865, "AZ"],
  [870, 884, "NM"],
  [889, 898, "NV"],
  [900, 961, "CA"],
  [967, 968, "HI"],
  [970, 979, "OR"],
  [980, 994, "WA"],
  [995, 999, "AK"],
];

const ZIP3_STATE = new Map<string, string>();
for (const [lo, hi, st] of ZIP3_RANGES) {
  for (let z = lo; z <= hi; z++) {
    ZIP3_STATE.set(String(z).padStart(3, "0"), st);
  }
}

/** `33138` / `FL 33138` → `US-FL`, or null when unknown. */
export function stateCodeFromUsZip(
  postalCode: string | null | undefined,
): string | null {
  const digits = String(postalCode || "").replace(/\D/g, "");
  if (digits.length < 5) return null;
  const abbr = ZIP3_STATE.get(digits.slice(0, 3));
  return abbr ? `US-${abbr}` : null;
}

/**
 * Prefer known city / ZIP / region over a conflicting hub default.
 * Known catalog city beats a ZIP that belongs to another state (hub dump
 * left Fresno 93721 on «Sunny Isles Beach»).
 * Returns ISO-ish `US-XX` or the normalized existing state.
 */
export function reconcileStateCode(input: {
  stateCode?: string | null;
  postalCode?: string | null;
  region?: string | null;
  regionState?: string | null;
  city?: string | null;
}): string | null {
  const existing = normalizeIsoState(input.stateCode);
  const fromZip = stateCodeFromUsZip(input.postalCode);
  const fromRegion = normalizeIsoState(input.regionState || input.region);
  const fromCity = stateCodeFromKnownCity(input.city);
  if (fromCity && fromZip && fromCity !== fromZip) return fromCity;
  if (fromCity && existing && fromCity !== existing) return fromCity;
  if (fromZip && existing && fromZip !== existing) return fromZip;
  if (fromRegion && existing && fromRegion !== existing && !fromZip) {
    return fromRegion;
  }
  return fromCity || fromZip || fromRegion || existing;
}

/** True when postal ZIP’s state disagrees with a known catalog city. */
export function postalConflictsKnownCity(
  city: string | null | undefined,
  postalCode: string | null | undefined,
): boolean {
  const fromCity = stateCodeFromKnownCity(city);
  const fromZip = stateCodeFromUsZip(postalCode);
  return Boolean(fromCity && fromZip && fromCity !== fromZip);
}

function normalizeIsoState(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toUpperCase();
  if (/^US-[A-Z]{2}$/.test(value)) return value;
  const abbr = value.match(
    /\b(A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEHINOST]|N[CDEHJMVY]|O[HKR]|P[AWR]|RI|S[CD]|T[NX]|UT|V[AIT]|W[AIVY])\b/,
  )?.[1];
  if (abbr) return `US-${abbr}`;
  if (/^[A-Z]{2}$/.test(value)) return `US-${value}`;
  return null;
}
