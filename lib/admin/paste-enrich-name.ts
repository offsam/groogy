/**
 * Company name for paste-enrich — import queue only.
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
const CONTACT_LINE_RE = /@|https?:\/\/|www\.|\d{3}[\s.\-)]\d{3}/i;

/**
 * Signage and flyers put the brand on the first prominent line, which the
 * narrative-oriented patterns in inferNameFromDescription do not catch.
 */
function firstHeadlineLine(text: string): string | null {
  for (const raw of (text || "").split(/\n+/).slice(0, 4)) {
    const line = raw.trim().replace(/^[«"“']+|[»"”'.,!]+$/g, "").trim();
    if (line.length < 3 || line.length > MAX_NAME_LEN) continue;
    if (CONTACT_LINE_RE.test(line)) continue;
    if (!/[A-Za-zА-Яа-яЁё]/.test(line)) continue;
    if (line.split(/\s+/).length > 6) continue;
    // A sentence is a description, not a sign.
    if (/[.!?]\s+\S/.test(line)) continue;
    return line;
  }
  return null;
}

/** Best-effort company name from pasted or photo-transcribed text. */
export function extractPasteEnrichName(text: string): string | null {
  const source = (text || "").trim();
  if (!source) return null;

  const candidates = [inferNameFromDescription(source), firstHeadlineLine(source)];
  for (const candidate of candidates) {
    const name = candidate?.trim();
    if (!name || name.length > MAX_NAME_LEN) continue;
    if (isJunkImportTitle(name)) continue;
    return name;
  }
  return null;
}

/** Same parse as everywhere else, plus the name the queue is allowed to fill. */
export function parsePasteEnrichTextWithName(text: string): PasteEnrichExtracted {
  return {
    ...parsePasteEnrichTextNormalized(text),
    name: extractPasteEnrichName(text),
  };
}
