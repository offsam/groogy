import type { Business } from "@/types/business";
import type { BusinessOffer } from "@/types/business-offer";
import type { Professional } from "@/types/professional";
import type { Job } from "@/types/job";
import type { ImportReviewItem } from "@/types/import-review";
import type { PlatformEvent } from "@/lib/events/queries";
import { structureEventFromText } from "@/lib/events/structure-event-from-text";
import {
  narrativeWithContactPointer,
  shortNarrativeTeaser,
} from "@/lib/content/structure-business-profile";
import { computePresenceFlags } from "@/lib/business/presence-flags";
import {
  isFacebookUrl,
  isTikTokUrl,
  pickPrimaryWebsiteFromList,
  pickYelpUrlFromList,
} from "@/lib/business/presence";
import {
  importCategoryLabel,
  resolveImportDisplayName,
  sanitizeInstagramHandles,
} from "@/lib/import-review/display-name";
import { mergeLocationWithGroupFallback } from "@/lib/geo/source-group-location";

/** Fields enough to render a public BusinessCard / profile teaser. */
export type ImportReviewPreviewFields = {
  id: string;
  title?: string | null;
  business_name?: string | null;
  person_name?: string | null;
  description?: string | null;
  description_original?: string | null;
  category?: string | null;
  city?: string | null;
  state?: string | null;
  address_line?: string | null;
  postal_code?: string | null;
  phone?: string[] | null;
  email?: string[] | null;
  website?: string[] | null;
  instagram?: string[] | null;
  services?: string[] | null;
  price?: number | null;
  currency?: string | null;
  photos_count?: number | null;
  preview_image_url?: string | null;
  entity_type?: string | null;
  target_collection?: string | null;
  whatsapp?: string[] | null;
  telegram_username?: string | null;
  telegram_user_id?: string | null;
  source_author_username?: string | null;
  source_text?: string | null;
  source_url?: string | null;
  source?: string | null;
  source_group?: string | null;
  payment_methods?: string[] | null;
  latitude?: number | null;
  longitude?: number | null;
};

function first(values: string[] | null | undefined): string | null {
  const v = (values ?? []).map((s) => s.trim()).find(Boolean);
  return v || null;
}

function asHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith("@")) return `https://www.instagram.com/${t.slice(1)}`;
  if (/instagram\.com/i.test(t)) return t.startsWith("http") ? t : `https://${t}`;
  return `https://${t}`;
}

function pickSocialUrl(
  urls: string[] | null | undefined,
  match: (u: string) => boolean,
): string | null {
  return asHttpUrl(first((urls ?? []).filter((w) => match(w.trim()))));
}

function shortFrom(description: string | null, services: string[]): string | null {
  const teaser = shortNarrativeTeaser(description, 160);
  if (teaser) return teaser;
  if (services.length) return services.slice(0, 3).join(" · ");
  return null;
}

/** Clean description for every queue preview — contacts → pointer to contacts block. */
function cleanPreviewDescription(
  description: string | null | undefined,
): string | null {
  return narrativeWithContactPointer(description).text;
}

/** Payment icons on every preview card — queue field or parse from ad text. */
export function resolvePreviewPaymentMethods(
  item: ImportReviewPreviewFields,
): string[] {
  const fromField = (item.payment_methods ?? [])
    .map((m) => m.trim())
    .filter(Boolean);
  if (fromField.length) {
    return Array.from(new Set(fromField));
  }
  const blob = [item.description, item.source_text, item.title]
    .filter((x): x is string => Boolean(x?.trim()))
    .join("\n");
  return structureEventFromText(blob).paymentMethods;
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "service"
  );
}

/** Map an import-review row (or live form) → public Business for card preview. */
export function importReviewToBusinessPreview(
  item: ImportReviewPreviewFields,
): Business {
  const resolved = resolveImportDisplayName(item);
  const name = resolved.name;
  const description = cleanPreviewDescription(item.description);
  const services = item.services ?? [];
  const website = pickPrimaryWebsiteFromList(item.website);
  const facebookUrl = pickSocialUrl(item.website, isFacebookUrl);
  const yelpUrl = pickYelpUrlFromList(item.website);
  const tiktokUrl = pickSocialUrl(item.website, isTikTokUrl);
  const youtubeUrl = pickSocialUrl(item.website, (u) =>
    /youtube\.com|youtu\.be/i.test(u),
  );
  const trustpilotUrl = pickSocialUrl(item.website, (u) =>
    /trustpilot\.com/i.test(u),
  );
  const igHandle = sanitizeInstagramHandles(item.instagram)[0] ?? null;
  const instagram = asHttpUrl(igHandle);
  const phone = first(item.phone);
  const email = first(item.email);
  const telegramUrl = item.telegram_username?.trim()
    ? `https://t.me/${item.telegram_username.replace(/^@/, "")}`
    : pickSocialUrl(item.website, (u) => /t\.me|telegram\.me/i.test(u));
  const categoryLabel = importCategoryLabel(item.category);
  const imageUrl = item.preview_image_url?.trim() || null;
  const presenceFlags = computePresenceFlags({
    phone,
    email,
    website,
    instagramUrl: instagram,
    telegramUrl,
    sourceUrl: item.source_url?.trim() || null,
    sourceKind: item.source_url?.trim()
      ? item.source?.toLowerCase().startsWith("facebook")
        ? "facebook"
        : "telegram"
      : null,
    facebookUrl,
    yelpUrl,
    googleMapsUrl: null,
  });
  const lat =
    typeof item.latitude === "number" && Number.isFinite(item.latitude)
      ? item.latitude
      : null;
  const lng =
    typeof item.longitude === "number" && Number.isFinite(item.longitude)
      ? item.longitude
      : null;

  return {
    id: item.id,
    slug: `preview-${item.id.slice(0, 8)}`,
    name,
    categoryId: null,
    categorySlug: item.category?.trim() || null,
    categoryName: categoryLabel,
    shortDescription: null,
    description,
    descriptionOriginal: item.description_original?.trim() || null,
    ratingAvg: 0,
    reviewsCount: 0,
    aiVerifiedReviewsCount: 0,
    transactionVerifiedReviewsCount: 0,
    phone,
    email,
    website,
    instagramUrl: instagram,
    telegramUrl,
    sourceUrl: item.source_url?.trim() || null,
    sourceKind: item.source_url?.trim()
      ? item.source?.toLowerCase().startsWith("facebook")
        ? "facebook"
        : "telegram"
      : null,
    facebookUrl,
    tiktokUrl,
    yelpUrl,
    yelpRating: null,
    yelpReviewsCount: 0,
    trustpilotUrl,
    trustpilotRating: null,
    trustpilotReviewsCount: 0,
    facebookRecommendPct: null,
    facebookReviewsCount: 0,
    instagramFollowersCount: null,
    googleMapsUrl: null,
    googleRating: null,
    googleReviewsCount: 0,
    bookingUrl: null,
    contactLinks: [
      ...(youtubeUrl
        ? [{ channel: "youtube" as const, value: youtubeUrl, label: null }]
        : []),
      ...(trustpilotUrl
        ? [
            {
              channel: "trustpilot" as const,
              value: trustpilotUrl,
              label: null,
            },
          ]
        : []),
    ],
    imageUrl,
    addressLine: item.address_line?.trim() || null,
    city: item.city?.trim() || null,
    region: item.state?.trim() || null,
    latitude: lat,
    longitude: lng,
    locationPrecision: item.address_line?.trim()
      ? "street"
      : lat != null
        ? "street"
        : null,
    openingHours: null,
    createdAt: null,
    presenceFlags,
    paymentMethods: resolvePreviewPaymentMethods(item),
  };
}

/** Map an import-review row → public Professional for card / profile preview. */
export function importReviewToProfessionalPreview(
  item: ImportReviewPreviewFields,
): Professional {
  const resolved = resolveImportDisplayName(item);
  const name = resolved.name;
  const description = cleanPreviewDescription(item.description);
  const services = item.services ?? [];
  const website = pickPrimaryWebsiteFromList(item.website);
  const igHandle = sanitizeInstagramHandles(item.instagram)[0] ?? null;
  const instagram = asHttpUrl(igHandle);
  const phone = first(item.phone);
  const email = first(item.email);
  const categoryLabel = importCategoryLabel(item.category);
  const imageUrl = item.preview_image_url?.trim() || null;
  const tg =
    item.telegram_username?.trim()
      ? `https://t.me/${item.telegram_username.replace(/^@/, "")}`
      : null;

  return {
    id: item.id,
    slug: `preview-${item.id.slice(0, 8)}`,
    displayName: name,
    headline: categoryLabel || shortFrom(description, services),
    shortDescription: null,
    description,
    descriptionOriginal: item.description_original?.trim() || null,
    imageUrl,
    status: "pending",
    experienceYears: null,
    languages: ["ru"],
    availabilityText: null,
    ratingAvg: 0,
    reviewsCount: 0,
    city: item.city?.trim() || null,
    region: item.state?.trim() || null,
    stateCode:
      item.state?.trim() &&
      !/county|оранж/i.test(item.state.trim())
        ? item.state.trim()
        : null,
    postalCode: item.postal_code?.trim() || null,
    latitude: null,
    longitude: null,
    addressLine: item.address_line?.trim() || null,
    locationPrecision: item.address_line?.trim()
      ? "street"
      : item.city?.trim()
        ? "city"
        : null,
    serviceAreaText: [item.city, item.state].filter(Boolean).join(", ") || null,
    publishedAt: null,
    createdAt: null,
    categoryId: null,
    categorySlug: item.category?.trim() || null,
    categoryName: categoryLabel,
    presenceFlags: {
      hasPhone: Boolean(phone),
      hasEmail: Boolean(email),
      hasWebsite: Boolean(website),
      hasInstagram: Boolean(instagram),
      hasTelegram: Boolean(tg),
      hasSource: Boolean(item.source_url?.trim()),
    },
    phone,
    email,
    website,
    instagramUrl: instagram,
    telegramUrl: tg,
    contactLinks: [],
    sourceUrl: item.source_url?.trim() || null,
    sourceKind: item.source_url?.trim()
      ? item.source?.toLowerCase().startsWith("facebook")
        ? "facebook"
        : "telegram"
      : null,
    servicePreviewTitles: services.slice(0, 3),
    serviceCount: services.length || undefined,
    paymentMethods: resolvePreviewPaymentMethods(item),
  };
}

/** Preview offers from services list (+ optional single price on first). */
export function importReviewToOfferPreviews(
  item: ImportReviewPreviewFields,
): BusinessOffer[] {
  const services = (item.services ?? []).map((s) => s.trim()).filter(Boolean);
  const now = new Date().toISOString();
  const list = services.length > 0 ? services.slice(0, 12) : [];
  const resolved = resolveImportDisplayName(item);
  return list.map((title, index) => ({
    id: `preview-offer-${item.id}-${index}`,
    businessId: item.id,
    businessSlug: `preview-${item.id.slice(0, 8)}`,
    businessName: resolved.name,
    offerType: "service" as const,
    title,
    slug: slugify(title),
    shortDescription: title,
    description: null,
    categoryId: null,
    categoryName: importCategoryLabel(item.category),
    subcategoryId: null,
    status: "active" as const,
    visibility: "public" as const,
    priceMode:
      index === 0 && item.price != null ? ("from" as const) : ("contact" as const),
    priceAmount: index === 0 && item.price != null ? Number(item.price) : null,
    priceMin: null,
    priceMax: null,
    currency: item.currency || "USD",
    priceUnit: "service",
    primaryImageUrl: null,
    sortOrder: index * 10,
    isFeatured: index === 0,
    isAvailable: true,
    attributes: {},
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    media: [],
  }));
}

export function importReviewItemToPreviewFields(
  item: ImportReviewItem,
): ImportReviewPreviewFields {
  const loc = mergeLocationWithGroupFallback({
    city: item.city,
    region: item.state,
    sourceGroup: item.source_group,
    source: item.source,
    text: [item.description, item.source_text].filter(Boolean).join("\n"),
  });
  // City-scoped groups → city; county-scoped (Fun for Mom / OC) → region as place label.
  // With a real street address, show City + CA — not «Irvine Orange County».
  const hasStreet = Boolean(item.address_line?.trim());
  const place = loc.city || loc.region || item.city?.trim() || null;
  const area = hasStreet && loc.city
    ? item.state?.trim() && !/county|оранж/i.test(item.state)
      ? item.state.trim()
      : loc.stateCode?.replace(/^US-/, "") || null
    : loc.city && loc.region
      ? loc.region
      : loc.stateCode
        ? loc.stateCode.replace(/^US-/, "")
        : item.state?.trim() || null;

  return {
    id: item.id,
    title: item.title,
    business_name: item.business_name,
    person_name: item.person_name,
    description: item.description || item.source_text,
    description_original: item.description_original ?? null,
    category: item.category,
    city: place,
    state: area,
    address_line: item.address_line?.trim() || null,
    postal_code: item.postal_code?.trim() || null,
    phone: item.phone,
    email: item.email,
    website: item.website,
    instagram: item.instagram,
    services: item.services,
    price: item.price,
    currency: item.currency,
    photos_count: item.photos_count,
    preview_image_url: item.preview_image_url,
    entity_type: item.entity_type,
    target_collection: item.target_collection,
    whatsapp: item.whatsapp,
    telegram_username: item.telegram_username,
    telegram_user_id: item.telegram_user_id,
    source_author_username: item.source_author_username,
    source_text: item.source_text,
    source_url: item.source_url,
    source: item.source,
    source_group: item.source_group,
    payment_methods: item.payment_methods ?? null,
    latitude: (() => {
      const v = item.raw_payload?.latitude;
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    })(),
    longitude: (() => {
      const v = item.raw_payload?.longitude;
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    })(),
  };
}

/** Queue → EventProfileView / EventCard preview (admin only). */
export function importReviewToEventPreview(
  fields: ImportReviewPreviewFields,
): PlatformEvent {
  const title =
    resolveImportDisplayName(fields).name ||
    fields.title?.trim() ||
    "Событие";

  let telegramUrl: string | null = null;
  if (fields.telegram_username?.trim()) {
    const handle = fields.telegram_username.trim().replace(/^@/, "");
    if (handle) telegramUrl = `https://t.me/${handle}`;
  }
  if (!telegramUrl) {
    for (const w of fields.website ?? []) {
      const m = w.match(/(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{4,32})/i);
      if (
        m?.[1] &&
        !/^\d+$/.test(m[1]) &&
        !["c", "s"].includes(m[1].toLowerCase())
      ) {
        telegramUrl = `https://t.me/${m[1]}`;
        break;
      }
    }
  }

  const priceLabel =
    fields.price != null
      ? `${fields.currency ?? "USD"} ${fields.price}`.trim()
      : null;

  const structured = structureEventFromText(
    [fields.description, fields.source_text, fields.title]
      .filter((x): x is string => Boolean(x?.trim()))
      .join("\n"),
  );

  // Prefer queue fields; fall back to affiche parse from the post body.
  const eventAtLabel = structured.eventAtLabel;
  const startsAt = structured.startsAt;
  const resolvedPrice =
    priceLabel ||
    structured.priceLabel ||
    (structured.priceAmount != null
      ? `$${structured.priceAmount}`
      : null);

  return {
    id: fields.id,
    title,
    slug: `preview-${fields.id.slice(0, 8)}`,
    description: cleanPreviewDescription(
      structured.description || fields.description || null,
    ),
    description_original: fields.description_original?.trim() || null,
    status: "pending",
    starts_at: startsAt,
    ends_at: null,
    event_at_label: eventAtLabel,
    city: fields.city ?? structured.city ?? null,
    state_code: fields.state ?? null,
    address_line: fields.address_line ?? structured.addressLine ?? null,
    latitude: null,
    longitude: null,
    cover_image_url: fields.preview_image_url ?? null,
    registration_url:
      pickPrimaryWebsiteFromList(fields.website) || structured.registrationUrl || null,
    source_url: fields.source_url ?? null,
    source_posted_at: null,
    source_body: fields.source_text ?? null,
    format: fields.address_line || structured.addressLine ? "offline" : null,
    price_label: resolvedPrice,
    payment_methods: resolvePreviewPaymentMethods(fields),
    phone: first(fields.phone) ?? structured.phone ?? null,
    telegram_url: telegramUrl,
    created_at: new Date().toISOString(),
  };
}

/** Queue → JobCard preview (admin only). */
export function importReviewToJobPreview(
  fields: ImportReviewPreviewFields,
): Job {
  const title =
    fields.title?.trim() ||
    fields.business_name?.trim() ||
    "Вакансия";
  const employer =
    fields.business_name?.trim() ||
    fields.person_name?.trim() ||
    null;
  return {
    id: fields.id,
    slug: `preview-${fields.id.slice(0, 8)}`,
    title,
    description: cleanPreviewDescription(fields.description),
    descriptionOriginal: fields.description_original?.trim() || null,
    city: fields.city ?? null,
    stateCode: fields.state ?? null,
    postalCode: null,
    status: "pending",
    businessId: null,
    businessSlug: null,
    businessName: employer,
    businessImageUrl: fields.preview_image_url ?? null,
    businessCity: fields.city ?? null,
    businessRegion: fields.state ?? null,
    businessAddressLine: null,
    businessLocationPrecision: null,
    paymentMethods: resolvePreviewPaymentMethods(fields),
    publishedAt: null,
    createdAt: new Date().toISOString(),
  };
}
