/**
 * Published enrich — identity correction.
 *
 * Telegram / FB imports often title a shop card with the poster's person name
 * («Maksim Degtyar») while the copy and contacts name the store
 * (L'amour Toujours Flower Boutique). After the resource crawl, finalize
 * runs this so enrich itself renames the card and flags «Не тот раздел».
 */

import {
  inferNameFromDescription,
  isJunkImportTitle,
  isPersonLikeImportName,
  taglineForBrand,
} from "@/lib/import-review/display-name";
import {
  RETAIL_STOREFRONT_RE,
  routeCard,
  type RouteResult,
} from "@/lib/import-review/entity-routing";
import type { ImportReviewTargetCollection } from "@/types/import-review";
import { catalogCardSlug } from "@/lib/routing/ascii-slug";

const JUNK_HEADLINE_RE = /^(?:услуга|специалист|услуги?)(?:\s*\/\s*(?:услуга|специалист|услуги?))?$/i;

const SHOP_CONTACT_RE =
  /flower|florist|boutique|магазин|бутик|цветы|delights|bakery|grocery|gourmet|salon|studio|clinic/i;

export type EnrichIdentityKind = "professional" | "business";

export type EnrichIdentityInput = {
  kind: EnrichIdentityKind;
  currentName: string;
  headline?: string | null;
  description: string;
  /** Full blob for routing (description + short + source ad). */
  routeText: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  instagramUrl?: string | null;
  addressLine?: string | null;
  postalCode?: string | null;
};

export type EnrichIdentityCorrection = {
  displayName?: string;
  /** Brand slug when renaming person title → store (business cards). */
  suggestedSlug?: string;
  headline?: string;
  sectionMismatch?: ImportReviewTargetCollection | null;
  route: RouteResult;
  reasons: string[];
};

function nameKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** URL slug from a brand / shop name (not for person display names alone). */
export function slugifyBusinessBrand(name: string): string {
  return catalogCardSlug({ name, fallback: "business" });
}

const PERSON_SLUG_SHOP_RE =
  /boutique|florist|flower|shop|store|market|bakery|deli|cafe|salon|studio|clinic|gallery|kitchen|grill|pizza|restaurant|магазин|бутик|салон/;

/** `maksim-degtyar` — short person-like slug without shop tokens. */
export function slugLooksLikePersonName(slug: string): boolean {
  const s = slug.trim().toLowerCase();
  if (!s || PERSON_SLUG_SHOP_RE.test(s)) return false;
  const parts = s.split("-").filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return false;
  return parts.every((p) => p.length >= 2 && p.length <= 16 && /^[a-z]+$/.test(p));
}

/** True when slug tokens do not overlap the live card name (orphan person URL). */
export function slugMismatchesBrandName(slug: string, brandName: string): boolean {
  const slugTok = new Set(slug.toLowerCase().split("-").filter((t) => t.length > 2));
  const nameTok = nameKey(brandName)
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9а-яё]/gi, ""))
    .filter((t) => t.length > 2);
  if (!slugTok.size || !nameTok.length) return true;
  return !nameTok.some((t) => slugTok.has(t.toLowerCase()));
}

function hasShopContact(input: EnrichIdentityInput): boolean {
  const blob = [input.website, input.email, input.instagramUrl]
    .filter(Boolean)
    .join(" ");
  return SHOP_CONTACT_RE.test(blob);
}

function isRetailBrandName(name: string): boolean {
  return (
    RETAIL_STOREFRONT_RE.test(name) ||
    /\b(boutique|florist|shop|store|market|bakery|deli|cafe|salon|studio|gallery|магазин|бутик)\b/i.test(
      name,
    )
  );
}

/**
 * Rename person-title → brand from copy, fix junk headline, and when the
 * copy is a retail storefront stuck on a specialist card, flag businesses
 * even without a street pin (map rule still keeps import as specialist).
 */
export function correctEnrichCardIdentity(
  input: EnrichIdentityInput,
): EnrichIdentityCorrection {
  const reasons: string[] = [];
  const currentName = input.currentName.trim();
  const nameSource = input.description.trim();
  const brandRaw = inferNameFromDescription(nameSource);
  const brand =
    brandRaw && !isJunkImportTitle(brandRaw) ? brandRaw : null;
  let nextName = currentName;
  let displayName: string | undefined;
  let headline: string | undefined;

  if (brand && currentName) {
    const haystack = ` ${nameKey(input.routeText)} `;
    const nameInCopy = haystack.includes(` ${nameKey(currentName)} `);
    const brandIsNew = nameKey(brand) !== nameKey(currentName);
    const personTitle = isPersonLikeImportName(currentName);
    const currentJunk = isJunkImportTitle(currentName);
    // Solid brand already on the card (Law Firm, Boutique, …) stays put —
    // only junk / person titles / names absent from copy may rename.
    const currentSolidBrand =
      !currentJunk &&
      !personTitle &&
      nameInCopy &&
      !isJunkImportTitle(currentName);
    if (
      brandIsNew &&
      !currentSolidBrand &&
      (currentJunk || !nameInCopy || personTitle)
    ) {
      displayName = brand.slice(0, 160);
      nextName = displayName;
      reasons.push(
        currentJunk
          ? "junk_title→brand"
          : personTitle
            ? "person_title→brand"
            : "title→brand",
      );
    }
  } else if (brand && !currentName) {
    displayName = brand.slice(0, 160);
    nextName = displayName;
    reasons.push("empty→brand");
  }

  if (input.kind === "professional") {
    const currentHeadline = (input.headline || "").trim();
    const headlineInCopy = currentHeadline
      ? ` ${nameKey(input.routeText)} `.includes(` ${nameKey(currentHeadline)} `)
      : true;
    const junkHeadline =
      !currentHeadline ||
      JUNK_HEADLINE_RE.test(currentHeadline) ||
      !headlineInCopy;
    if (junkHeadline) {
      const tagline = taglineForBrand(nameSource, brand ?? nextName);
      if (tagline && nameKey(tagline) !== nameKey(currentHeadline)) {
        headline = tagline;
        reasons.push("headline→tagline");
      } else if (
        (brand || nextName) &&
        isRetailBrandName(brand ?? nextName) &&
        nameKey(brand ?? nextName) !== nameKey(currentHeadline)
      ) {
        headline = (brand ?? nextName).slice(0, 160);
        reasons.push("headline→brand");
      }
    }
  }

  const renamedToBrand = Boolean(displayName);
  const effectiveIsPerson =
    isPersonLikeImportName(nextName) && !isRetailBrandName(nextName);
  const route = routeCard({
    text: input.routeText,
    businessName:
      input.kind === "business" || renamedToBrand || !effectiveIsPerson
        ? nextName || null
        : null,
    personName:
      input.kind === "professional" && effectiveIsPerson && !renamedToBrand
        ? nextName || null
        : null,
    hasContact: Boolean(
      input.phone || input.email || input.instagramUrl || input.website,
    ),
    addressLine: input.addressLine,
    postalCode: input.postalCode,
  });

  const expected: ImportReviewTargetCollection =
    input.kind === "business" ? "businesses" : "private_specialists";
  let sectionMismatch: ImportReviewTargetCollection | null =
    route.targetCollection && route.targetCollection !== expected
      ? route.targetCollection
      : null;

  // Import keeps no-street retail as specialist (map pin rule). Published
  // enrich still surfaces «Не тот раздел → Бизнесы» when contacts/copy are a shop.
  if (
    !sectionMismatch &&
    input.kind === "professional" &&
    /retail_storefront_re|company_operations_re/.test(route.reason) &&
    /no_street→specialist/.test(route.reason) &&
    (hasShopContact(input) ||
      isRetailBrandName(nextName) ||
      RETAIL_STOREFRONT_RE.test(input.routeText))
  ) {
    sectionMismatch = "businesses";
    reasons.push("section→businesses_storefront");
  }

  if (sectionMismatch) reasons.push(`section_mismatch:${sectionMismatch}`);

  let suggestedSlug: string | undefined;
  if (
    input.kind === "business" &&
    displayName &&
    isRetailBrandName(displayName)
  ) {
    suggestedSlug = slugifyBusinessBrand(displayName);
    reasons.push("slug→brand");
  }

  return {
    displayName,
    suggestedSlug,
    headline,
    sectionMismatch,
    route,
    reasons,
  };
}
