/**
 * Company name for paste-enrich (queue + live cards, fill-empty).
 *
 * Lives apart from paste-enrich.ts because display-name.ts already imports
 * from there; composing here keeps the two modules acyclic.
 */

import {
  parsePasteEnrichTextNormalized,
  type PasteEnrichExtracted,
} from "@/lib/admin/paste-enrich";
import {
  inferNameFromDescription,
  isJunkImportTitle,
} from "@/lib/import-review/display-name";

const MAX_NAME_LEN = 80;
const CONTACT_LINE_RE =
  /@|https?:\/\/|www\.|\d{3}[\s.\-)]\d{3}|t\.me\/|telegram\.me\/|youtube\.com\/|youtu\.be\/|instagram\.com\/|facebook\.com\/|wa\.me\//i;

/** «Dr. Smith» is a title, not a sentence opener. */
const HONORIFIC_ABBREV_RE =
  /\b(?:Dr|Mr|Mrs|Ms|Jr|Sr|St|Ave|Blvd|Rd|Lt|Ltd|Inc|Co|Prof)\./i;

/**
 * Google Maps place-type under the rating («Emergency dental service»,
 * «Dance school», «Gourmet grocery store») — short category lines only.
 * Longer brands that end in Studio/Salon («Dance Code Ballroom Studio»)
 * must stay as names.
 */
const MAPS_CATEGORY_LINE_RE =
  /^(?:emergency\s+)?(?:[A-Za-z][A-Za-z']*\s+){0,2}(?:service|services|store|shop|restaurant|cafe|café|bar|clinic|salon|spa|gym|church|school|hospital|pharmacy|bakery|grocery|market|dentist|dentistry|office|center|centre|studio|kitchen|grill|bistro|deli|foods?)$/i;

const MAPS_UI_LINE_RE =
  /^(?:website|directions|overview|reviews|photos|products|about|nearby|save|share|call|suggest\s+new\s+hours|open\s+now|send\s+to\s+phone|sponsored|by\s+groupon\b.*|get\s+deals\b.*|map\s+of\b.*|links?|ссылки|youtube|ютуб|telegram|телеграм(?:м)?|instagram|facebook|whatsapp|service\s*rates?(?:\s*&?\s*pricing)?|rates?\s*&?\s*pricing)$/i;

const MAPS_HOURS_STATUS_RE =
  /^(?:open|closed|opens?|closes?)\b/i;

const RATING_ONLY_RE = /^\d(?:[.,]\d)?$/;
const REVIEWS_COUNT_RE =
  /^\(?\d{1,6}\)?$|^\d{1,6}\s*(?:reviews?|отзыв(?:ов|а)?|ratings?)$/i;

/** City, ST ZIP — not a business name. */
const CITY_STATE_ZIP_LINE_RE =
  /^[A-Za-z][A-Za-z.\s]+,\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/;

/** Client-safe street check (avoid importing server-only geocode). */
function looksLikeStreetLine(line: string): boolean {
  const v = line.trim();
  if (!v) return false;
  if (
    /^\d{1,6}\s+(?:County\s+(?:Road|Rd)|CR|State\s+(?:Route|Hwy|Highway|Rd|Road)|SR|US\s*(?:Hwy|Highway)|(?:State\s+)?(?:Hwy|Highway)|Interstate|I-?)\s*\d+/i.test(
      v,
    )
  ) {
    return true;
  }
  if (
    !/^\d{1,6}\s+(?:\d{1,3}(?:st|nd|rd|th)\b|[A-Za-zА-Яа-я])/i.test(v)
  ) {
    return false;
  }
  return !/^\d{1,6}\s+\d+\s*$/.test(v);
}

function looksLikeSentenceNotTitle(line: string): boolean {
  // Period that ends a real sentence, not Dr. / Mr. / Ave.
  const withoutHonorific = line.replace(HONORIFIC_ABBREV_RE, "Dr");
  if (/[.!?]\s+\S/.test(withoutHonorific)) return true;
  return false;
}

function isMapsCategoryLine(line: string): boolean {
  // Brands like «Dance Code Ballroom Studio» end with Studio but are names.
  if (line.split(/\s+/).length > 3) return false;
  return MAPS_CATEGORY_LINE_RE.test(line);
}

function isStreetOrPlaceLine(line: string): boolean {
  if (looksLikeStreetLine(line)) return true;
  if (CITY_STATE_ZIP_LINE_RE.test(line.trim())) return true;
  return false;
}

function isMapsNoiseHeadline(line: string): boolean {
  if (RATING_ONLY_RE.test(line)) return true;
  if (REVIEWS_COUNT_RE.test(line)) return true;
  if (MAPS_UI_LINE_RE.test(line)) return true;
  if (MAPS_HOURS_STATUS_RE.test(line)) return true;
  if (isMapsCategoryLine(line)) return true;
  if (isStreetOrPlaceLine(line)) return true;
  if (/^services?\s*[:：]/i.test(line)) return true;
  if (/^·+$/.test(line)) return true;
  if (/^j\d[a-z0-9+]+\b/i.test(line)) return true; // plus code «J7C9+6W …»
  // Glued rate-table dump used as a fake title.
  if (/rates?\s*&?\s*pricing/i.test(line) && line.length > 28) return true;
  if (/\$\d{2,5}/.test(line) && /(?:labor|welding|rate|hour)/i.test(line)) {
    return true;
  }
  return false;
}

/**
 * Signage and flyers put the brand on the first prominent line, which the
 * narrative-oriented patterns in inferNameFromDescription do not catch.
 */
function firstHeadlineLine(text: string): string | null {
  for (const raw of (text || "").split(/\n+/).slice(0, 12)) {
    const line = raw.trim().replace(/^[«"“']+|[»"”'.,!]+$/g, "").trim();
    if (line.length < 3 || line.length > MAX_NAME_LEN) continue;
    if (CONTACT_LINE_RE.test(line)) continue;
    if (!/[A-Za-zА-Яа-яЁё]/.test(line)) continue;
    if (line.split(/\s+/).length > 8) continue;
    if (isMapsNoiseHeadline(line)) continue;
    if (looksLikeSentenceNotTitle(line)) continue;
    return line;
  }
  return null;
}

/** Best-effort company name from pasted or photo-transcribed text. */
export function extractPasteEnrichName(text: string): string | null {
  const source = (text || "").trim();
  if (!source) return null;

  const candidates = [firstHeadlineLine(source), inferNameFromDescription(source)];
  for (const candidate of candidates) {
    const name = candidate?.trim();
    if (!name || name.length > MAX_NAME_LEN) continue;
    if (isJunkImportTitle(name)) continue;
    if (isMapsNoiseHeadline(name)) continue;
    return name;
  }
  return null;
}

/** Same parse as everywhere else, plus inferred company name (fill-empty). */
export function parsePasteEnrichTextWithName(text: string): PasteEnrichExtracted {
  return {
    ...parsePasteEnrichTextNormalized(text),
    name: extractPasteEnrichName(text),
  };
}
