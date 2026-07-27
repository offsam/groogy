/**
 * Structured US address rules for КРУГИ.
 * address_line = street only; city / state / ZIP / county live in their own fields.
 * No paid Places autocomplete — free CityCombobox covers cities.
 */

export type StructuredAddress = {
  /** Street / suite only — no city, state, ZIP, or county. */
  addressLine: string | null;
  city: string | null;
  /** County or metro label only, e.g. "Orange County". Not ZIP/state. */
  region: string | null;
  /** ISO-ish subdivision code, e.g. US-CA. */
  stateCode: string | null;
  /** 5-digit US ZIP (optional +4 stripped for storage). */
  postalCode: string | null;
};

export type AddressValidationIssue = {
  field: keyof StructuredAddress | "form";
  message: string;
};

const ZIP_RE = /\b(\d{5})(?:-\d{4})?\b/;
const STATE_ABBR_RE = /\b(A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEHINOST]|N[CDEHJMVY]|O[HKR]|P[AWR]|RI|S[CD]|T[NX]|UT|V[AIT]|W[AIVY])\b/i;

const STATE_NAMES: Record<string, string> = {
  california: "US-CA",
  калифорния: "US-CA",
  arizona: "US-AZ",
  nevada: "US-NV",
  oregon: "US-OR",
  washington: "US-WA",
  texas: "US-TX",
  florida: "US-FL",
  "new york": "US-NY",
};

const COUNTY_RE =
  /\b(orange|los\s+angeles|san\s+diego|sacramento|san\s+francisco|san\s+mateo|riverside|san\s+bernardino|ventura|santa\s+barbara|kern)\s+county\b/i;

const COUNTY_ALIASES: Record<string, string> = {
  oc: "Orange County",
  "orange county": "Orange County",
  "los angeles county": "Los Angeles County",
  "la county": "Los Angeles County",
  "san diego county": "San Diego County",
  "sacramento county": "Sacramento County",
  "san francisco county": "San Francisco County",
  "sf county": "San Francisco County",
  "bay area": "San Francisco County",
  "san mateo county": "San Mateo County",
  "riverside county": "Riverside County",
  "san bernardino county": "San Bernardino County",
};

/** Trailing junk often pasted after a real street. */
const TRAILING_META_RE =
  /(?:,\s*)?(?:orange\s+county|los\s+angeles\s+county|san\s+diego\s+county|\boc\b|california|калифорния|,?\s*CA\s*\d{5}(?:-\d{4})?|,?\s*CA\b|,?\s*USA\b|,?\s*United\s+States\b|\d{5}(?:-\d{4})?)\s*$/gi;

const CITY_STATE_ZIP_TAIL_RE =
  /,\s*([A-Za-zА-Яа-яЁё .'-]+)\s*,\s*(CA|California|калифорния|[A-Z]{2})\s*(\d{5}(?:-\d{4})?)?\s*$/i;

const CITY_ZIP_TAIL_RE =
  /,\s*([A-Za-zА-Яа-яЁё .'-]+)\s+(\d{5}(?:-\d{4})?)\s*$/i;

/** Recognized street suffixes — used to tell real streets from venue/business names. */
const STREET_SUFFIX_RE =
  /\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|ct|court|cir|circle|pl|place|pkwy|parkway|hwy|highway|ter|terrace|trl|trail|aly|alley|calle|camino|blvd\.|rd\.|st\.|ave\.|dr\.|ln\.)\b/i;

const VENUE_ONLY_RE =
  /\b(salon|studio|clinic|spa|school|agency|boutique|barbershop|кафе|салон|студия|клиника|агентство)\b/i;

function cleanWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/^[,.\s]+|[,.\s]+$/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when text looks like a street (house # and/or street suffix), not a venue name. */
export function looksLikeStreetAddress(line: string | null | undefined): boolean {
  if (!line?.trim()) return false;
  const t = cleanWhitespace(line);
  if (/^\d{1,6}\b/.test(t)) return true;
  if (STREET_SUFFIX_RE.test(t) && !VENUE_ONLY_RE.test(t.split(",")[0] ?? t)) {
    return true;
  }
  return false;
}

/**
 * Remove business/venue names from a street line.
 * "32773 Calle Perfecto (Perspektive Studio)" → "32773 Calle Perfecto"
 * "Wonderland Salon" (same as business name) → null
 */
export function stripBusinessNameFromStreet(
  street: string | null | undefined,
  businessName?: string | null,
): string | null {
  if (!street?.trim()) return null;
  let line = cleanWhitespace(street);

  // Drop parenthetical / bracket notes (often studio or suite nicknames).
  line = cleanWhitespace(
    line.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " "),
  );

  const name = businessName?.trim() || "";
  if (name) {
    const nameLower = name.toLowerCase();
    const lineLower = line.toLowerCase();

    // Entire field is the business name (or name + city).
    if (lineLower === nameLower) return null;
    if (lineLower.startsWith(nameLower + ",") || lineLower.startsWith(nameLower + " —") || lineLower.startsWith(nameLower + " -")) {
      line = cleanWhitespace(line.slice(name.length).replace(/^[,—\-\s]+/, ""));
    }
    if (lineLower.endsWith(nameLower) && lineLower !== nameLower) {
      const without = line.slice(0, line.length - name.length);
      line = cleanWhitespace(without.replace(/[,—\-\s]+$/, ""));
    }

    // Remove full name as a substring when long enough to be distinctive.
    if (name.length >= 5) {
      line = cleanWhitespace(
        line.replace(new RegExp(escapeRegExp(name), "ig"), " "),
      );
    }

    // Significant tokens from the name (skip street-ish words).
    const tokens = name
      .split(/[^\p{L}\p{N}]+/u)
      .map((t) => t.trim())
      .filter(
        (t) =>
          t.length >= 5 &&
          !STREET_SUFFIX_RE.test(t) &&
          !/^\d+$/.test(t) &&
          !["center", "centre", "business", "street", "avenue"].includes(
            t.toLowerCase(),
          ),
      );
    for (const token of tokens) {
      line = cleanWhitespace(
        line.replace(new RegExp(`\\b${escapeRegExp(token)}\\b`, "ig"), " "),
      );
    }
  }

  // Trailing em-dash person/brand tails: "123 Main St — Elizabeth Azamatov"
  line = cleanWhitespace(line.replace(/\s+[—–-]\s+[A-Za-zА-Яа-яЁё].*$/u, ""));

  if (!line) return null;
  if (!looksLikeStreetAddress(line)) return null;
  return line.slice(0, 160);
}

export function extractZip(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  // Bare ZIP
  if (/^\d{5}(?:-\d{4})?$/.test(trimmed)) return trimmed.slice(0, 5);

  // Prefer ZIP after state: "CA 92618" / "California 92618"
  const afterState = trimmed.match(
    /\b(?:A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEHINOST]|N[CDEHJMVY]|O[HKR]|P[AWR]|RI|S[CD]|T[NX]|UT|V[AIT]|W[AIVY]|California|california|калифорния)\s+(\d{5})(?:-\d{4})?\b/i,
  );
  if (afterState?.[1]) return afterState[1];

  // "Costa Mesa, CA 92627" / "Concord, CA 94520"
  const cityStateZip = trimmed.match(
    /\b[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё .'-]{1,40},\s*(?:CA|California|FL|NY|TX|AZ|OR|WA|NV)\s+(\d{5})(?:-\d{4})?\b/iu,
  );
  if (cityStateZip?.[1]) return cityStateZip[1];

  // ", 92618"
  const commaZip = trimmed.match(/,\s*(\d{5})(?:-\d{4})?\b/);
  if (commaZip?.[1]) return commaZip[1];

  const trailing = trimmed.match(/(?<!\d)(\d{5})(?:-\d{4})?\s*$/);
  if (trailing?.[1]) {
    const before = trimmed.slice(0, trailing.index).trim();
    const house = before.match(/^(\d{1,6})\b/);
    // Ignore when ZIP equals the leading house number ("15825 Laguna…")
    if (house && house[1] === trailing[1] && !before.includes(" ")) return null;
    if (house && house[1] === trailing[1]) return null;
    return trailing[1];
  }
  return null;
}

/**
 * Find a US ZIP in free-form business copy (description, short, street paste).
 * Never treats a leading street house number as a ZIP.
 */
export function extractZipFromBusinessText(
  value: string | null | undefined,
): string | null {
  if (!value?.trim()) return null;

  // Strong patterns first (state-qualified).
  const afterState = value.match(
    /\b(?:CA|California|FL|NY|TX|AZ|OR|WA|NV|California|калифорния)\s+(\d{5})(?:-\d{4})?\b/i,
  );
  if (afterState?.[1]) return afterState[1];

  const cityStateZip = value.match(
    /\b[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё .'-]{1,40},\s*(?:CA|California|FL|NY|TX|AZ|OR|WA|NV)\s+(\d{5})(?:-\d{4})?\b/iu,
  );
  if (cityStateZip?.[1]) return cityStateZip[1];

  const commaZip = value.match(/,\s*(\d{5})(?:-\d{4})?\b/);
  if (commaZip?.[1]) {
    // Ignore ", 13662 Newport Ave" style — ZIP then street name words
    const after = value.slice((commaZip.index ?? 0) + commaZip[0].length);
    if (!/^\s*[A-Za-z]/.test(after)) return commaZip[1];
  }

  // Do not scan bare 5-digit tokens — too often house numbers.
  return extractZip(value);
}

/**
 * City + ZIP for listing / map preview cards.
 * Pulls missing ZIP from street, short, or description without exposing the street.
 */
export function resolvePublicCityPostal(input: {
  addressLine?: string | null;
  city?: string | null;
  region?: string | null;
  stateCode?: string | null;
  postalCode?: string | null;
  shortDescription?: string | null;
  description?: string | null;
  businessName?: string | null;
}): { city: string | null; postalCode: string | null } {
  const parsed = normalizeStructuredAddress({
    addressLine: input.addressLine,
    city: input.city,
    region: input.region,
    stateCode: input.stateCode,
    postalCode: input.postalCode,
    businessName: input.businessName,
  });

  let city = parsed.city;
  let postalCode = parsed.postalCode;

  if (!postalCode) {
    postalCode =
      extractZipFromBusinessText(input.addressLine) ||
      extractZipFromBusinessText(input.shortDescription) ||
      extractZipFromBusinessText(input.description) ||
      extractZipFromBusinessText(
        [input.city, input.region, input.stateCode].filter(Boolean).join(", "),
      );
  }

  // City still missing — try "…, Costa Mesa, CA 92627" crumbs in copy
  if (!city || looksLikeCountyLabel(city) || /orange county\s*\/\s*la/i.test(city)) {
    const blob = [
      input.addressLine,
      input.shortDescription,
      input.description,
    ]
      .filter(Boolean)
      .join("\n");
    const cityMatch = blob.match(
      /\b([A-Za-z][A-Za-z .'-]{1,40}),\s*(?:CA|California)\s+\d{5}\b/i,
    );
    if (cityMatch?.[1]) {
      const cand = cleanWhitespace(cityMatch[1]);
      if (cand && !looksLikeCountyLabel(cand)) city = cand;
    } else if ((!city || looksLikeCountyLabel(city)) && input.addressLine) {
      // "23221 S Pointe dr, suite 103, Laguna Hills"
      const tailCity = input.addressLine.match(
        /,\s*([A-Za-z][A-Za-z .'-]{1,40})\s*$/,
      );
      if (tailCity?.[1] && !/\b(ste|suite|apt|unit|#)\b/i.test(tailCity[1])) {
        city = cleanWhitespace(tailCity[1]);
      }
    }
  }

  if (postalCode) postalCode = extractZip(postalCode) ?? postalCode;
  return {
    city: city || null,
    postalCode: postalCode || null,
  };
}

export function normalizeCountyLabel(
  value: string | null | undefined,
): string | null {
  if (!value?.trim()) return null;
  const lower = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (COUNTY_ALIASES[lower]) return COUNTY_ALIASES[lower];
  const m = lower.match(COUNTY_RE);
  if (m) {
    const raw = m[0].replace(/\s+/g, " ");
    return raw.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return null;
}

export function stateCodeFromText(
  value: string | null | undefined,
): string | null {
  if (!value?.trim()) return null;
  const raw = value.trim();
  if (/^US-[A-Z]{2}$/i.test(raw)) return raw.toUpperCase();
  const lower = raw.toLowerCase().replace(/\s+/g, " ");
  if (STATE_NAMES[lower]) return STATE_NAMES[lower];
  for (const [name, code] of Object.entries(STATE_NAMES)) {
    if (lower.includes(name)) return code;
  }
  const abbr = raw.match(STATE_ABBR_RE)?.[1];
  if (abbr) return `US-${abbr.toUpperCase()}`;
  return null;
}

/**
 * Strip city/state/ZIP/county tails from a street line.
 * "123 Main St, Irvine, CA 92618, Orange County" → "123 Main St"
 */
export function stripStreetMeta(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  let line = cleanWhitespace(raw);

  // Full "Street, City, ST ZIP" tail
  const cityState = line.match(CITY_STATE_ZIP_TAIL_RE);
  if (cityState) {
    line = cleanWhitespace(line.slice(0, cityState.index));
  }

  // "Street, City 92618"
  const cityZip = line.match(CITY_ZIP_TAIL_RE);
  if (cityZip) {
    line = cleanWhitespace(line.slice(0, cityZip.index));
  }

  // Repeated trailing meta tokens
  for (let i = 0; i < 4; i += 1) {
    const next = line.replace(TRAILING_META_RE, "").trim();
    if (next === line) break;
    line = cleanWhitespace(next);
  }

  // Remove trailing ", Irvine" only when it looks like a city (no street suffix after comma)
  line = line.replace(
    /,\s*[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё .'-]{1,40}\s*$/u,
    (tail) => {
      // Keep if the part after comma looks like suite/unit
      if (/\b(ste|suite|apt|unit|bldg|#|floor|fl)\b/i.test(tail)) return tail;
      return "";
    },
  );

  line = cleanWhitespace(line);
  return line || null;
}

function looksLikeCountyLabel(value: string): boolean {
  return Boolean(normalizeCountyLabel(value));
}

/**
 * Parse messy free-text / split fields into structured address.
 * Prefers explicit field values; pulls missing pieces out of addressLine.
 * Pass businessName so venue/brand text is stripped from the street field.
 */
export function normalizeStructuredAddress(input: {
  addressLine?: string | null;
  city?: string | null;
  region?: string | null;
  stateCode?: string | null;
  postalCode?: string | null;
  /** When set, strips this name / brand tokens from addressLine. */
  businessName?: string | null;
}): StructuredAddress {
  let addressLine = input.addressLine?.trim() || null;
  let city = input.city?.trim() || null;
  let region = input.region?.trim() || null;
  let stateCode = input.stateCode?.trim() || null;
  let postalCode = input.postalCode?.trim() || null;

  const blob = [addressLine, city, region, postalCode].filter(Boolean).join(", ");

  if (!postalCode) postalCode = extractZip(blob);
  if (!stateCode) stateCode = stateCodeFromText(blob) ?? stateCodeFromText(region);

  // Pull city/state/zip from a full address pasted into street field
  if (addressLine) {
    // Peel county first so ", Irvine, CA 92618, Orange County" parses cleanly.
    const countyInStreet = addressLine.match(COUNTY_RE);
    if (countyInStreet) {
      if (!normalizeCountyLabel(region)) {
        region = normalizeCountyLabel(countyInStreet[0]);
      }
      addressLine = cleanWhitespace(
        addressLine.replace(COUNTY_RE, "").replace(/,\s*,/g, ","),
      );
    }

    const full = addressLine.match(CITY_STATE_ZIP_TAIL_RE);
    if (full) {
      if (!city) city = cleanWhitespace(full[1]);
      if (!stateCode) stateCode = stateCodeFromText(full[2]);
      if (!postalCode && full[3]) {
        postalCode = extractZip(full[3]) ?? full[3].slice(0, 5);
      }
    } else {
      const cz = addressLine.match(CITY_ZIP_TAIL_RE);
      if (cz) {
        if (!city) city = cleanWhitespace(cz[1]);
        if (!postalCode) postalCode = extractZip(cz[2]);
      }
    }
  }

  // region used as ZIP dump historically ("CA 92618", "Orange County 92618")
  if (region) {
    const zipOnly = region.match(/^\s*(\d{5})(?:-\d{4})?\s*$/);
    if (zipOnly) {
      if (!postalCode) postalCode = zipOnly[1];
      region = null;
    } else {
      const regionZip = extractZip(region);
      if (regionZip && !postalCode) postalCode = regionZip;
      if (!stateCode) stateCode = stateCodeFromText(region);
      const county = normalizeCountyLabel(region);
      region = county;
    }
  }

  // city wrongly set to county
  if (city && looksLikeCountyLabel(city) && !region) {
    region = normalizeCountyLabel(city);
    city = null;
  }

  addressLine = stripStreetMeta(addressLine);
  addressLine = stripBusinessNameFromStreet(addressLine, input.businessName);

  // Don't keep ZIP/state inside city
  if (city) {
    if (!postalCode) postalCode = extractZip(city) ?? postalCode;
    if (!stateCode) stateCode = stateCodeFromText(city) ?? stateCode;
    const cityIsCounty = Boolean(normalizeCountyLabel(city));
    if (cityIsCounty) {
      if (!region) region = normalizeCountyLabel(city);
      city = null;
    } else if (/^california$/i.test(city) || STATE_NAMES[city.toLowerCase()]) {
      if (!stateCode) stateCode = stateCodeFromText(city);
      city = null;
    } else {
      city = cleanWhitespace(
        city
          .replace(ZIP_RE, "")
          .replace(STATE_ABBR_RE, "")
          .replace(/california|калифорния/gi, "")
          .replace(/,/g, " "),
      );
      if (!city) city = null;
    }
  }

  if (postalCode) {
    postalCode = extractZip(postalCode);
  }

  if (stateCode && !stateCode.startsWith("US-") && stateCode.length === 2) {
    stateCode = `US-${stateCode.toUpperCase()}`;
  }

  return {
    addressLine: addressLine ? addressLine.slice(0, 160) : null,
    city: city ? city.slice(0, 80) : null,
    region: region ? region.slice(0, 80) : null,
    stateCode: stateCode || null,
    postalCode: postalCode || null,
  };
}

function streetHasZipOrStateMeta(street: string): {
  hasZip: boolean;
  hasState: boolean;
  hasCounty: boolean;
} {
  const hasZip =
    /\b(?:CA|California|калифорния|[A-Z]{2})\s+\d{5}\b/i.test(street) ||
    /,\s*\d{5}\b/.test(street) ||
    (/\s\d{5}(?:-\d{4})?\s*$/.test(street) &&
      !/^\d{5}\s+\S+/.test(street));
  const hasState =
    /\b(california|калифорния)\b/i.test(street) ||
    /,\s*(?:A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEHINOST]|N[CDEHJMVY]|O[HKR]|P[AWR]|RI|S[CD]|T[NX]|UT|V[AIT]|W[AIVY])\b/.test(
      street,
    ) ||
    /\s(?:CA|NY|TX|FL|WA|OR|NV|AZ)\s+\d{5}\b/i.test(street);
  const hasCounty = COUNTY_RE.test(street) || /(^|[\s,])oc([\s,]|$)/i.test(street);
  return { hasZip, hasState, hasCounty };
}

/**
 * Validate structured address before save.
 * Street must not contain state / ZIP / county / business name.
 */
export function validateStructuredAddress(
  address: StructuredAddress,
  options?: { businessName?: string | null },
): AddressValidationIssue[] {
  const issues: AddressValidationIssue[] = [];
  const street = address.addressLine;
  const businessName = options?.businessName?.trim() || "";

  if (street) {
    if (!looksLikeStreetAddress(street)) {
      issues.push({
        field: "addressLine",
        message:
          "В «Улице» только адрес (номер и название улицы), не название бизнеса или места.",
      });
    }
    if (
      businessName &&
      street.toLowerCase().includes(businessName.toLowerCase())
    ) {
      issues.push({
        field: "addressLine",
        message: "Не указывайте название бизнеса в адресе — только улицу.",
      });
    }
    const meta = streetHasZipOrStateMeta(street);
    if (meta.hasZip) {
      issues.push({
        field: "addressLine",
        message: "В поле «Улица» не указывайте ZIP — для него отдельное поле.",
      });
    }
    if (meta.hasState) {
      issues.push({
        field: "addressLine",
        message: "В поле «Улица» не указывайте штат — выберите его отдельно.",
      });
    }
    if (meta.hasCounty) {
      issues.push({
        field: "addressLine",
        message:
          "В поле «Улица» не указывайте округ (Orange County и т.п.) — для него поле «Округ».",
      });
    }
    if (street.includes(",") && !/\b(ste|suite|apt|unit|#)\b/i.test(street)) {
      const parts = street.split(",").map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 3) {
        issues.push({
          field: "addressLine",
          message:
            "Улица должна быть одной строкой без города и штата. Пример: 123 Main St, Ste 200.",
        });
      }
    }
  }

  if (address.region) {
    if (ZIP_RE.test(address.region) || stateCodeFromText(address.region)) {
      issues.push({
        field: "region",
        message: "В «Округе» только название (Orange County), без ZIP и штата.",
      });
    }
  }

  if (address.postalCode && !/^\d{5}$/.test(address.postalCode)) {
    issues.push({
      field: "postalCode",
      message: "ZIP должен быть из 5 цифр (например 92618).",
    });
  }

  if (address.city && normalizeCountyLabel(address.city)) {
    issues.push({
      field: "city",
      message: "«Orange County» — это округ, не город. Укажите город (Irvine и т.п.).",
    });
  }

  if (!address.addressLine && !address.city && !address.region) {
    issues.push({
      field: "form",
      message: "Укажите улицу или хотя бы город.",
    });
  }

  return issues;
}

/** Human-readable one-line for cards/maps (no duplicate county after ZIP). */
export function formatStructuredAddressLine(address: StructuredAddress): string {
  const parts: string[] = [];
  if (address.addressLine) parts.push(address.addressLine);
  const cityState: string[] = [];
  if (address.city) cityState.push(address.city);
  if (address.stateCode) {
    const abbr = address.stateCode.includes("-")
      ? address.stateCode.split("-").pop()!
      : address.stateCode;
    if (address.postalCode) cityState.push(`${abbr} ${address.postalCode}`);
    else cityState.push(abbr);
  } else if (address.postalCode) {
    cityState.push(address.postalCode);
  }
  if (cityState.length) parts.push(cityState.join(", "));
  // County only when no city (county-level pin)
  if (address.region && !address.city) parts.push(address.region);
  return parts.join(", ");
}
