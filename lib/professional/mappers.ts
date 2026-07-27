import {
  isFacebookUrl,
  isInstagramUrl,
  isTelegramUrl,
  normalizeTelegramInput,
} from "@/lib/business/presence";
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

  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    headline: row.headline,
    shortDescription: row.short_description,
    description: row.description,
    cardSummary: row.card_summary ?? null,
    imageUrl: row.image_url || PLACEHOLDER,
    status: row.status,
    experienceYears: row.experience_years,
    languages: row.languages ?? ["ru"],
    availabilityText: row.availability_text,
    ratingAvg: Number(row.rating_avg) || 0,
    reviewsCount: row.reviews_count ?? 0,
    likesCount: Number(row.likes_count ?? 0),
    followersCount: Number(row.followers_count ?? 0),
    city: row.city,
    region: row.region,
    stateCode: row.state_code,
    postalCode: row.postal_code ?? null,
    latitude: row.latitude,
    longitude: row.longitude,
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
    },
    phone: null,
    email: null,
    website: null,
    instagramUrl: null,
    telegramUrl: null,
    sourceUrl: null,
    sourceKind,
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
    has_phone: Boolean(row.phone?.trim()),
    has_email: Boolean(row.email?.trim()),
    has_website: Boolean(website && !isInstagramUrl(website)),
    has_instagram: Boolean(instagramDirect || instagramFromWeb),
    has_telegram: Boolean(telegramUrl),
    has_source:
      sourceKind === "platform" || Boolean(row.source_url?.trim()),
    source_kind: sourceKind,
  });
  return {
    ...base,
    phone: row.phone,
    email: row.email,
    website: website && !isInstagramUrl(website) ? website : null,
    instagramUrl: instagramDirect || instagramFromWeb,
    telegramUrl,
    sourceUrl:
      sourceKind === "platform" ? null : row.source_url?.trim() || null,
    sourceKind,
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
  sort_order: number;
}): ProfessionalService {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priceMode: row.price_mode,
    priceAmount: row.price_amount == null ? null : Number(row.price_amount),
    priceMin: row.price_min == null ? null : Number(row.price_min),
    priceMax: row.price_max == null ? null : Number(row.price_max),
    currency: row.currency,
    priceUnit: row.price_unit,
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
      return "По договорённости";
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
      return "По договорённости";
  }
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
