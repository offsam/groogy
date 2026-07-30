import {
  isDirectorySourceUrl,
  isFacebookUrl,
  isInstagramUrl,
  isTelegramUrl,
  normalizeTelegramInput,
} from "@/lib/business/presence";
import { redactContactsFromPublicText } from "@/lib/content/structure-business-profile";
import { parseContactLinks } from "@/lib/contacts/channels";
import type {
  Professional,
  ProfessionalPublicRow,
  ProfessionalRow,
  ProfessionalService,
  ProfessionalSourceKind,
} from "@/types/professional";

const PLACEHOLDER = "/placeholder.svg";

/** Derive public source kind from professionals.source_type / source_url. */
export function deriveProfessionalSourceKind(
  sourceType: string | null | undefined,
  sourceUrl: string | null | undefined,
): ProfessionalSourceKind {
  const type = (sourceType ?? "").trim().toUpperCase();
  const url = sourceUrl?.trim() || null;

  if (type === "USER" || type === "ADMIN") return "platform";
  if (url && isDirectorySourceUrl(url)) return "directory";
  if (type === "IMPORT" && url && !isTelegramUrl(url) && !isFacebookUrl(url)) {
    return "directory";
  }
  if (type === "TELEGRAM") return "telegram";
  if (type === "FACEBOOK") return "facebook";
  if (url) {
    if (isFacebookUrl(url)) return "facebook";
    if (isTelegramUrl(url)) return "telegram";
  }
  return null;
}

export function mapProfessionalPublic(row: ProfessionalPublicRow): Professional {
  const sourceKind =
    row.source_kind ??
    deriveProfessionalSourceKind(
      (row as ProfessionalRow).source_type,
      (row as ProfessionalRow).source_url,
    );
  const hasSource =
    row.has_source ??
    (sourceKind === "platform" ||
      Boolean((row as ProfessionalRow).source_url?.trim()));

  const website = (row as ProfessionalRow).website?.trim() || null;
  const hasInstagram =
    Boolean(row.has_instagram) ||
    Boolean(website && isInstagramUrl(website));
  const hasTelegram = Boolean(row.has_telegram);
  const hasWebsite =
    Boolean(row.has_website) && !(website && isInstagramUrl(website));
  const bookingUrl =
    row.booking_url?.trim() ||
    (row as ProfessionalRow).booking_url?.trim() ||
    null;
  const hasBooking = Boolean(row.has_booking) || Boolean(bookingUrl);
  const contactLinks = parseContactLinks(row.contact_links);

  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    // Public narrative only — phones/handles live in the contacts block.
    headline: redactContactsFromPublicText(row.headline),
    shortDescription: redactContactsFromPublicText(row.short_description),
    description: redactContactsFromPublicText(row.description),
    descriptionOriginal: redactContactsFromPublicText(
      row.description_original ?? null,
    ),
    cardSummary: redactContactsFromPublicText(row.card_summary ?? null),
    imageUrl: row.image_url || PLACEHOLDER,
    status: row.status,
    experienceYears: row.experience_years,
    languages: row.languages ?? ["ru"],
    availabilityText: row.availability_text,
    ratingAvg: Number(row.rating_avg) || 0,
    reviewsCount: row.reviews_count ?? 0,
    city: row.city,
    region: row.region,
    stateCode: row.state_code,
    postalCode: row.postal_code ?? null,
    addressLine: row.address_line?.trim() || null,
    latitude: row.latitude,
    longitude: row.longitude,
    locationPrecision: row.location_precision ?? null,
    serviceAreaText: row.service_area_text,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    categoryId: row.category_id ?? null,
    categorySlug: row.category_slug ?? null,
    categoryName: row.category_name ?? null,
    presenceFlags: {
      hasPhone: Boolean(row.has_phone),
      hasEmail: Boolean(row.has_email),
      hasWebsite,
      hasInstagram,
      hasTelegram,
      hasSource: Boolean(hasSource),
      hasBooking,
      extraChannels: contactLinks.map((link) => link.channel),
    },
    phone: null,
    email: null,
    website: null,
    bookingUrl,
    paymentMethods: (row.payment_methods ?? []).filter(Boolean),
    instagramUrl: null,
    telegramUrl: null,
    contactLinks: [],
    sourceUrl: null,
    sourceKind,
    employerName: row.employer_name?.trim() || null,
    employerRole: row.employer_role?.trim() || null,
    employerBusinessId: row.employer_business_id ?? null,
    employerBusinessSlug: row.employer_business_slug?.trim() || null,
    employerBusinessName: row.employer_business_name?.trim() || null,
    employerBusinessImageUrl: row.employer_business_image_url?.trim() || null,
    employerBusinessCity: row.employer_business_city?.trim() || null,
    employerBusinessPostalCode: row.employer_business_postal_code?.trim() || null,
    employerBusinessStateCode: row.employer_business_state_code?.trim() || null,
    employerBusinessAddressLine:
      row.employer_business_address_line?.trim() || null,
    employerBusinessGoogleRating:
      row.employer_business_google_rating == null
        ? null
        : Number(row.employer_business_google_rating),
    employerBusinessGoogleReviewsCount:
      row.employer_business_google_reviews_count == null
        ? null
        : Number(row.employer_business_google_reviews_count),
    thirdPartyMentionCount:
      row.third_party_mention_count == null
        ? null
        : Number(row.third_party_mention_count),
    selfAdMentionCount:
      row.self_ad_mention_count == null
        ? null
        : Number(row.self_ad_mention_count),
  };
}

export function mapProfessionalOwner(row: ProfessionalRow): Professional {
  const sourceKind = deriveProfessionalSourceKind(
    row.source_type,
    row.source_url,
  );
  const telegramUrl = normalizeTelegramInput(row.telegram_url);
  const website = row.website?.trim() || null;
  const instagramDirect = row.instagram_url?.trim() || null;
  const instagramFromWeb =
    website && isInstagramUrl(website) ? website : null;

  const base = mapProfessionalPublic({
    ...row,
    address_line:
      row.address_line?.trim() || row.private_address_line?.trim() || null,
    booking_url: row.booking_url?.trim() || null,
    has_phone: Boolean(row.phone?.trim()),
    has_email: Boolean(row.email?.trim()),
    has_website: Boolean(website && !isInstagramUrl(website)),
    has_instagram: Boolean(instagramDirect || instagramFromWeb),
    has_telegram: Boolean(telegramUrl),
    has_booking: Boolean(row.booking_url?.trim()),
    has_source:
      sourceKind === "platform" || Boolean(row.source_url?.trim()),
    source_kind: sourceKind,
  });
  return {
    ...base,
    // Owner/edit: keep raw copy (public mapper redacts contacts for guests).
    headline: row.headline,
    shortDescription: row.short_description,
    description: row.description,
    cardSummary: row.card_summary ?? null,
    phone: row.phone,
    email: row.email,
    website: website && !isInstagramUrl(website) ? website : null,
    bookingUrl: row.booking_url?.trim() || base.bookingUrl || null,
    instagramUrl: instagramDirect || instagramFromWeb,
    telegramUrl,
    contactLinks: parseContactLinks(row.contact_links),
    sourceUrl:
      sourceKind === "platform" ? null : row.source_url?.trim() || null,
    sourceKind,
    addressLine:
      row.address_line?.trim() ||
      row.private_address_line?.trim() ||
      base.addressLine ||
      null,
  };
}

export function mapProfessionalService(row: {
  id: string;
  title: string;
  description: string | null;
  price_mode: ProfessionalService["priceMode"];
  price_amount: number | null;
  price_min: number | null;
  price_max: number | null;
  currency: string;
  price_unit: string | null;
  duration_minutes?: number | null;
  sort_order: number;
}): ProfessionalService {
  return {
    id: row.id,
    title: row.title,
    description: redactContactsFromPublicText(row.description),
    priceMode: row.price_mode,
    priceAmount: row.price_amount == null ? null : Number(row.price_amount),
    priceMin: row.price_min == null ? null : Number(row.price_min),
    priceMax: row.price_max == null ? null : Number(row.price_max),
    currency: row.currency,
    priceUnit: row.price_unit,
    durationMinutes:
      row.duration_minutes == null || Number.isNaN(Number(row.duration_minutes))
        ? null
        : Number(row.duration_minutes),
    sortOrder: row.sort_order,
  };
}

export function formatProfessionalPrice(service: ProfessionalService): string {
  const cur = service.currency || "USD";
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 0,
    }).format(n);

  switch (service.priceMode) {
    case "free":
      return "Бесплатно";
    case "contact":
      return "Цену уточняйте";
    case "from":
      return service.priceAmount != null ? `от ${fmt(service.priceAmount)}` : "от …";
    case "range":
      if (service.priceMin != null && service.priceMax != null) {
        return `${fmt(service.priceMin)} – ${fmt(service.priceMax)}`;
      }
      return "Диапазон";
    case "fixed":
      return service.priceAmount != null ? fmt(service.priceAmount) : "Фикс";
    default:
      return "Цену уточняйте";
  }
}

export function formatProfessionalDuration(
  minutes: number | null | undefined,
): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return `${h} ч ${m} мин`;
  if (h > 0) return `${h} ч`;
  return `${m} мин`;
}

export function slugifyProfessionalName(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const stamp = Date.now().toString(36).slice(-4);
  return `${base || "pro"}-${stamp}`;
}
