/**
 * Queue completeness score — mirrors Python `score_queue_item` in
 * `scripts/business-enrich/run_enrichment_pipeline.py` (+ weights from
 * `completeness_score.py`). Used so Admin UI matches enrich history
 * (e.g. 65→73), not the separate checklist %.
 */

import type { ImportReviewItem } from "@/types/import-review";
import { resolveImportPreviewKind } from "@/lib/import-review/preview-section";

const PLACEHOLDER_DESCRIPTIONS = new Set([
  "без описания",
  "нет описания",
  "no description",
  "n/a",
  "тбд",
  "tbd",
]);

const BUSINESS_WEIGHTS = {
  name: 5,
  category_id: 5,
  city: 3,
  postal_code: 2,
  address_line: 5,
  geo: 3,
  opening_hours: 8,
  description: 8,
  image_url: 5,
  phone: 5,
  website: 5,
  instagram_url: 3,
  telegram_url: 2,
  facebook_url: 2,
  whatsapp: 2,
  email: 2,
  booking_url: 3,
  google_rating: 5,
  google_reviews_count_gt_10: 3,
  yelp_rating: 3,
  trustpilot_rating: 2,
  offers_count_ge_3: 5,
  offers_with_price_ge_1: 5,
  promotions: 3,
  jobs: 2,
  source_url: 2,
  short_description: 2,
} as const;

const PROFESSIONAL_WEIGHTS = {
  display_name: 8,
  category_id_not_other: 10,
  city: 8,
  postal_code: 3,
  any_contact: 15,
  phone: 5,
  website: 5,
  instagram_url: 4,
  telegram_url: 4,
  email: 3,
  headline: 5,
  description: 8,
  card_summary: 5,
  image_url: 8,
  opening_hours: 5,
  service_area_text: 4,
} as const;

const LISTING_WEIGHTS = {
  title: 20,
  price: 20,
  description: 20,
  image: 15,
  city: 10,
  contact: 15,
} as const;

function hasValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function isRealText(
  value: unknown,
  minLen = 40,
  minWords = 6,
): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  if (PLACEHOLDER_DESCRIPTIONS.has(text.toLowerCase())) return false;
  if (text.length < minLen) return false;
  if (text.split(/\s+/).filter(Boolean).length < minWords) return false;
  return true;
}

function firstOf(value: unknown): unknown {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function scoreBusinessRow(row: Record<string, unknown>): number {
  const w = BUSINESS_WEIGHTS;
  let score = 0;
  if (hasValue(row.name)) score += w.name;
  if (hasValue(row.category_id)) score += w.category_id;
  if (hasValue(row.city)) score += w.city;
  if (hasValue(row.postal_code)) score += w.postal_code;
  if (hasValue(row.address_line)) score += w.address_line;
  if (row.latitude != null && row.longitude != null) score += w.geo;
  if (hasValue(row.opening_hours)) score += w.opening_hours;
  if (
    isRealText(row.description) ||
    isRealText(row.short_description)
  ) {
    score += w.description;
  }
  if (hasValue(row.image_url)) score += w.image_url;
  if (hasValue(row.phone)) score += w.phone;
  if (hasValue(row.website)) score += w.website;
  if (hasValue(row.instagram_url)) score += w.instagram_url;
  if (hasValue(row.telegram_url)) score += w.telegram_url;
  if (hasValue(row.facebook_url)) score += w.facebook_url;
  if (hasValue(row.whatsapp)) score += w.whatsapp;
  if (hasValue(row.email)) score += w.email;
  if (hasValue(row.booking_url)) score += w.booking_url;
  if (hasValue(row.google_rating)) score += w.google_rating;
  if (Number(row.google_reviews_count ?? 0) > 10) {
    score += w.google_reviews_count_gt_10;
  }
  if (hasValue(row.yelp_rating)) score += w.yelp_rating;
  if (hasValue(row.trustpilot_rating)) score += w.trustpilot_rating;
  if (Number(row.offers_count ?? 0) >= 3) score += w.offers_count_ge_3;
  if (Number(row.offers_with_price_count ?? 0) >= 1) {
    score += w.offers_with_price_ge_1;
  }
  if (Number(row.offers_featured_count ?? 0) >= 1) score += w.promotions;
  if (Number(row.jobs_count ?? 0) >= 1) score += w.jobs;
  if (hasValue(row.source_url)) score += w.source_url;
  if (isRealText(row.short_description, 15, 6)) {
    score += w.short_description;
  }
  return score;
}

function scoreProfessionalRow(row: Record<string, unknown>): number {
  const w = PROFESSIONAL_WEIGHTS;
  let score = 0;
  if (hasValue(row.display_name)) score += w.display_name;

  const slug = row.category_slug;
  const categoryOk =
    slug !== undefined
      ? hasValue(row.category_id) && slug !== "pro_other"
      : hasValue(row.category_id);
  if (categoryOk) score += w.category_id_not_other;

  if (hasValue(row.city) || hasValue(row.service_area_text)) score += w.city;
  if (hasValue(row.postal_code)) score += w.postal_code;

  const contacts = [
    row.phone,
    row.website,
    row.instagram_url,
    row.telegram_url,
    row.email,
  ];
  if (contacts.some(hasValue)) score += w.any_contact;

  if (hasValue(row.phone)) score += w.phone;
  if (hasValue(row.website)) score += w.website;
  if (hasValue(row.instagram_url)) score += w.instagram_url;
  if (hasValue(row.telegram_url)) score += w.telegram_url;
  if (hasValue(row.email)) score += w.email;
  if (hasValue(row.headline)) score += w.headline;
  if (
    isRealText(row.description) ||
    isRealText(row.short_description)
  ) {
    score += w.description;
  }
  if (hasValue(row.card_summary)) score += w.card_summary;
  if (hasValue(row.image_url)) score += w.image_url;
  if (hasValue(row.opening_hours)) score += w.opening_hours;
  if (hasValue(row.service_area_text)) score += w.service_area_text;
  return score;
}

function scoreListingRow(row: Record<string, unknown>): number {
  const w = LISTING_WEIGHTS;
  let score = 0;
  const title = String(row.title ?? row.business_name ?? "").trim();
  if (title) score += w.title;
  if (row.price != null) score += w.price;
  const desc = String(row.description ?? row.source_text ?? "").trim();
  if (desc) score += w.description;
  if (
    String(row.preview_image_url ?? "").trim() ||
    Number(row.photos_count ?? 0) > 0
  ) {
    score += w.image;
  }
  if (String(row.city ?? "").trim()) score += w.city;
  const hasContact = [
    "phone",
    "whatsapp",
    "email",
    "website",
    "instagram",
    "telegram_username",
  ].some((k) => hasValue(row[k]));
  if (hasContact) score += w.contact;
  return score;
}

export type QueueScoreEntity = "business" | "professional" | "listing";

export function resolveQueueScoreEntity(
  item: Pick<ImportReviewItem, "entity_type" | "target_collection">,
): QueueScoreEntity {
  const kind = resolveImportPreviewKind(item);
  if (kind === "professional") return "professional";
  if (kind === "business") return "business";
  return "listing";
}

/**
 * Same integer as enrich CLI / history (`score 65→73`).
 * Queue has no hours/offers/geo — this is a floor, not final published score.
 */
export function scoreImportReviewQueueItem(
  item: ImportReviewItem,
  patch: Partial<ImportReviewItem> = {},
): number {
  const row = { ...item, ...patch } as ImportReviewItem &
    Record<string, unknown>;
  const entity = resolveQueueScoreEntity(item);

  const hasContact = [
    row.phone,
    row.whatsapp,
    row.email,
    row.website,
    row.instagram,
    row.telegram_username,
  ].some(hasValue);

  if (entity === "listing") {
    return scoreListingRow({
      ...row,
      title: row.title,
      business_name: row.business_name,
      // Structured copy only — raw telegram dump is not a filled listing.
      description: row.description,
      source_text: null,
      preview_image_url: row.preview_image_url,
      photos_count: row.photos_count,
      city: row.city,
      price: row.price,
      phone: row.phone,
      whatsapp: row.whatsapp,
      email: row.email,
      website: row.website,
      instagram: row.instagram,
      telegram_username: row.telegram_username,
      _has_contact: hasContact,
    });
  }

  // Match Python score_queue_item mapping exactly (floor — no hours/offers/geo).
  // Queue UX: do NOT treat raw source_text dump as a filled description —
  // that made empty shells look ~70% complete.
  const mapped: Record<string, unknown> = {
    city: row.city,
    phone: firstOf(row.phone),
    website: firstOf(row.website),
    email: firstOf(row.email),
    instagram_url: firstOf(row.instagram),
    telegram_url: row.telegram_username,
    description: row.description,
    short_description: row.short_description,
    image_url: row.preview_image_url,
    source_url: row.source_url,
    category_id: row.category,
  };

  if (entity === "business") {
    mapped.name = row.business_name || row.title;
    return scoreBusinessRow(mapped);
  }

  mapped.display_name = row.person_name || row.title;
  return scoreProfessionalRow(mapped);
}
