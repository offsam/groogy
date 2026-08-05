/**
 * Near-duplicate street matching (typos / unit formatting).
 * Pure — safe for client and unit tests.
 */

function toStateCode(state: string | null | undefined): string | null {
  const s = (state || "").trim().toUpperCase().replace(/^US-/, "");
  if (!s) return null;
  return s.length === 2 ? `US-${s}` : s;
}

function houseNumber(street: string | null | undefined): string | null {
  const m = (street || "").trim().match(/^(\d{1,6})\b/);
  return m?.[1] ?? null;
}

/** Street name without house #, unit, or type (hwy/rd/st…). */
function streetNameCore(street: string | null | undefined): string {
  let s = (street || "").toLowerCase().normalize("NFKD");
  // Normalize before stripping punctuation so «#1» stays a unit, not a lone «1».
  s = s.replace(/#\s*/g, "unit ");
  s = s.replace(
    /\b(?:unit|ste|suite|apt|apartment)\s*[a-z0-9-]+\b/gi,
    " ",
  );
  s = s.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  s = s.replace(/^\d{1,6}\s+/, "");
  s = s.replace(
    /\b(?:highway|hwy|road|rd|street|st|avenue|ave|drive|dr|boulevard|blvd|lane|ln|court|ct|place|pl|parkway|pkwy|circle|cir|way|terrace|ter|trail|trl)\b/gi,
    " ",
  );
  return s.replace(/\s+/g, " ").trim();
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const cols = b.length + 1;
  const prev = new Array<number>(cols);
  const cur = new Array<number>(cols);
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j < cols; j++) prev[j] = cur[j]!;
  }
  return prev[b.length]!;
}

/**
 * Same physical place despite typos («Indusrtial» vs «Industrial») or
 * unit formatting («#1» vs «Unit 1»).
 */
export function isSamePhysicalStreetPlace(
  existing: {
    address_line?: string | null;
    city?: string | null;
    state_code?: string | null;
    postal_code?: string | null;
  },
  incoming: {
    addressLine?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
  },
): boolean {
  const numA = houseNumber(existing.address_line);
  const numB = houseNumber(incoming.addressLine);
  if (!numA || !numB || numA !== numB) return false;

  const cityA = (existing.city || "").toLowerCase().trim();
  const cityB = (incoming.city || "").toLowerCase().trim();
  if (cityA && cityB && cityA !== cityB) return false;

  const stA = (existing.state_code || "").replace(/^US-/i, "").toUpperCase();
  const stB = (toStateCode(incoming.state) || "")
    .replace(/^US-/i, "")
    .toUpperCase();
  if (stA && stB && stA !== stB) return false;

  const zipA = (existing.postal_code || "").replace(/\D/g, "").slice(0, 5);
  const zipB = (incoming.postalCode || "").replace(/\D/g, "").slice(0, 5);
  if (zipA && zipB && zipA !== zipB) return false;

  const nameA = streetNameCore(existing.address_line);
  const nameB = streetNameCore(incoming.addressLine);
  if (!nameA || !nameB) return Boolean(zipA && zipB && zipA === zipB);
  if (nameA === nameB) return true;
  const dist = editDistance(nameA, nameB);
  const maxLen = Math.max(nameA.length, nameB.length);
  if (dist <= 2) return true;
  return maxLen >= 8 && dist <= 3;
}
