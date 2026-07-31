/**
 * Field richness for merge / enrich: never replace a rich value with a weaker
 * one, and treat placeholders / junk as empty so stronger data can fill in.
 */

import { hasRealBusinessPhoto } from "@/lib/business/media";
import {
  isJunkImportTitle,
  isPersonLikeImportName,
} from "@/lib/import-review/display-name";

export { hasRealBusinessPhoto };

/** Real photo URL, or null when empty / category SVG / placeholder. */
export function realImageUrl(
  url: string | null | undefined,
): string | null {
  const trimmed = String(url || "").trim();
  if (!trimmed || !hasRealBusinessPhoto(trimmed)) return null;
  return trimmed;
}

/**
 * Prefer donor image when the current slot is empty or only a category
 * placeholder — never drop a real photo for a weaker one.
 */
export function preferRicherImage(
  current: string | null | undefined,
  donor: string | null | undefined,
): string | null {
  const mine = realImageUrl(current);
  if (mine) return mine;
  return realImageUrl(donor);
}

/** Identity string that is junk / snake handle / role word. */
export function isWeakIdentityName(raw: string | null | undefined): boolean {
  return isJunkImportTitle(raw);
}

/**
 * Prefer a fuller person / brand name over junk, snake handles, and bare
 * first names when the candidate is clearly richer.
 */
export function preferRicherIdentityName(
  current: string | null | undefined,
  candidate: string | null | undefined,
): string | null {
  const cur = String(current || "").trim();
  const next = String(candidate || "").trim();
  if (!next || isWeakIdentityName(next)) {
    return cur || null;
  }
  if (!cur || isWeakIdentityName(cur)) return next;
  if (cur.localeCompare(next, undefined, { sensitivity: "accent" }) === 0) {
    return cur;
  }
  if (isPersonLikeImportName(next)) {
    if (!isPersonLikeImportName(cur)) return next;
    const curParts = cur.split(/\s+/).length;
    const nextParts = next.split(/\s+/).length;
    if (nextParts > curParts || next.length >= cur.length + 3) return next;
  }
  return cur;
}
