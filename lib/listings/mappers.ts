import type {
  AuthorVisibility,
  Listing,
  ListingCategory,
  ListingMedia,
  ListingPublisher,
  ListingStatus,
  ListingVisibility,
  MarketplaceDetails,
  PublicProfileCard,
  PublisherType,
  ServiceListingDetails,
  ServiceMode,
  TransferListingDetails,
  TransferMethod,
  LechuListingDetails,
  LechuRewardType,
} from "@/types/listing";
import type { Database } from "@/types/database";

type ListingRow = Database["public"]["Tables"]["listings"]["Row"];
type MediaRow = Database["public"]["Tables"]["listing_media"]["Row"];
type CategoryRow = Database["public"]["Tables"]["listing_categories"]["Row"];
type DetailsRow =
  Database["public"]["Tables"]["marketplace_listing_details"]["Row"];
type ServiceDetailsRow =
  Database["public"]["Tables"]["service_listing_details"]["Row"];
type TransferDetailsRow =
  Database["public"]["Tables"]["transfer_listing_details"]["Row"];
type LechuDetailsRow =
  Database["public"]["Tables"]["lechu_listing_details"]["Row"];

const STORAGE_BUCKET = "listing-images";

/** @deprecated Prefer signed URLs via signListingMediaUrls for private bucket. */
export function publicStorageUrl(
  supabaseUrl: string,
  storagePath: string,
): string {
  return `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`;
}

export function mapCategory(row: CategoryRow): ListingCategory {
  return {
    id: row.id,
    slug: row.slug,
    nameRu: row.name_ru,
    nameEn: row.name_en,
    sortOrder: row.sort_order,
    domain: row.domain,
  };
}

export function mapMedia(
  row: MediaRow,
  signedUrl: string | null = null,
): ListingMedia {
  return {
    id: row.id,
    listingId: row.listing_id,
    storagePath: row.storage_path,
    sortOrder: row.sort_order,
    publicUrl: signedUrl,
  };
}

export function mapMarketplaceDetails(
  row: DetailsRow & {
    listing_categories?: CategoryRow | CategoryRow[] | null;
  },
): MarketplaceDetails {
  const catRaw = row.listing_categories;
  const cat = Array.isArray(catRaw) ? catRaw[0] : catRaw;
  return {
    categoryId: row.category_id,
    condition: row.condition,
    transactionType: row.transaction_type,
    deliveryAvailable: row.delivery_available,
    pickupAvailable: row.pickup_available,
    quantity: row.quantity,
    category: cat ? mapCategory(cat) : null,
  };
}

export function mapServiceDetails(
  row: ServiceDetailsRow & {
    listing_categories?: CategoryRow | CategoryRow[] | null;
  },
): ServiceListingDetails {
  const catRaw = row.listing_categories;
  const cat = Array.isArray(catRaw) ? catRaw[0] : catRaw;
  return {
    serviceCategoryId: row.service_category_id,
    pricingType: row.pricing_type,
    priceFrom: row.price_from != null ? Number(row.price_from) : null,
    priceTo: row.price_to != null ? Number(row.price_to) : null,
    priceUnit: row.price_unit,
    serviceModes: (row.service_modes ?? []) as ServiceMode[],
    serviceArea: row.service_area,
    experienceYears: row.experience_years,
    languages: row.languages ?? ["ru"],
    licenseInfo: row.license_info,
    insuranceStatus: row.insurance_status,
    availabilityText: row.availability_text,
    offersFreeEstimate: row.offers_free_estimate,
    offersEmergencyService: row.offers_emergency_service,
    category: cat ? mapCategory(cat) : null,
  };
}

export function mapTransferDetails(
  row: TransferDetailsRow & {
    listing_categories?: CategoryRow | CategoryRow[] | null;
  },
): TransferListingDetails {
  const catRaw = row.listing_categories;
  const cat = Array.isArray(catRaw) ? catRaw[0] : catRaw;
  return {
    categoryId: row.category_id,
    fromCountry: row.from_country,
    toCountry: row.to_country,
    transferMethod: row.transfer_method as TransferMethod,
    feePercent: row.fee_percent != null ? Number(row.fee_percent) : null,
    feeFixedUsd: row.fee_fixed_usd != null ? Number(row.fee_fixed_usd) : null,
    minAmountUsd: row.min_amount_usd != null ? Number(row.min_amount_usd) : null,
    maxAmountUsd: row.max_amount_usd != null ? Number(row.max_amount_usd) : null,
    processingDays: row.processing_days,
    category: cat ? mapCategory(cat) : null,
  };
}

export function mapLechuDetails(
  row: LechuDetailsRow & {
    listing_categories?: CategoryRow | CategoryRow[] | null;
  },
): LechuListingDetails {
  const catRaw = row.listing_categories;
  const cat = Array.isArray(catRaw) ? catRaw[0] : catRaw;
  return {
    categoryId: row.category_id,
    departureCountry: row.departure_country,
    destinationCountry: row.destination_country,
    departureDate: row.departure_date,
    carryTypes: row.carry_types ?? [],
    maxWeightKg: row.max_weight_kg != null ? Number(row.max_weight_kg) : null,
    sizeLimit: row.size_limit,
    rewardType: row.reward_type as LechuRewardType,
    category: cat ? mapCategory(cat) : null,
  };
}

export function mapAuthorDisplay(raw: Record<string, unknown> | null): {
  mode: AuthorVisibility;
  label: string;
  avatarUrl: string | null;
  username: string | null;
  profilePath: string | null;
} | null {
  if (!raw) return null;
  return {
    mode: (raw.mode as AuthorVisibility) ?? "anonymous",
    label: String(raw.label ?? "Пользователь"),
    avatarUrl: (raw.avatar_url as string | null) ?? null,
    username: (raw.username as string | null) ?? null,
    profilePath: (raw.profile_path as string | null) ?? null,
  };
}

export function mapListingPublisher(
  raw: Record<string, unknown> | null,
): ListingPublisher | null {
  if (!raw) return null;
  const publisherType = (raw.publisher_type as PublisherType) ?? "profile";
  const authorRaw = raw.author as Record<string, unknown> | undefined;
  return {
    publisherType,
    businessId: (raw.business_id as string | null) ?? null,
    slug: (raw.slug as string | null) ?? null,
    name: (raw.name as string | null) ?? null,
    logoUrl: (raw.logo_url as string | null) ?? null,
    author: authorRaw ? mapAuthorDisplay(authorRaw) : null,
  };
}

export function mapListing(
  row: ListingRow & {
    marketplace_listing_details?:
      | (DetailsRow & {
          listing_categories?: CategoryRow | CategoryRow[] | null;
        })
      | (DetailsRow & {
          listing_categories?: CategoryRow | CategoryRow[] | null;
        })[]
      | null;
    service_listing_details?:
      | (ServiceDetailsRow & {
          listing_categories?: CategoryRow | CategoryRow[] | null;
        })
      | (ServiceDetailsRow & {
          listing_categories?: CategoryRow | CategoryRow[] | null;
        })[]
      | null;
    transfer_listing_details?:
      | (TransferDetailsRow & {
          listing_categories?: CategoryRow | CategoryRow[] | null;
        })
      | (TransferDetailsRow & {
          listing_categories?: CategoryRow | CategoryRow[] | null;
        })[]
      | null;
    lechu_listing_details?:
      | (LechuDetailsRow & {
          listing_categories?: CategoryRow | CategoryRow[] | null;
        })
      | (LechuDetailsRow & {
          listing_categories?: CategoryRow | CategoryRow[] | null;
        })[]
      | null;
    listing_media?: MediaRow[] | null;
  },
  media: ListingMedia[] = [],
  author?: ReturnType<typeof mapAuthorDisplay>,
  favoritedByMe = false,
  ownerIdForViewer?: string,
  publisher?: ListingPublisher | null,
): Listing {
  const detailsRaw = row.marketplace_listing_details;
  const details = Array.isArray(detailsRaw)
    ? detailsRaw[0] ?? null
    : detailsRaw ?? null;

  const serviceRaw = row.service_listing_details;
  const serviceDetails = Array.isArray(serviceRaw)
    ? serviceRaw[0] ?? null
    : serviceRaw ?? null;

  const transferRaw = row.transfer_listing_details;
  const transferDetails = Array.isArray(transferRaw)
    ? transferRaw[0] ?? null
    : transferRaw ?? null;

  const lechuRaw = row.lechu_listing_details;
  const lechuDetails = Array.isArray(lechuRaw)
    ? lechuRaw[0] ?? null
    : lechuRaw ?? null;

  return {
    id: row.id,
    ownerId: ownerIdForViewer ?? row.owner_id,
    listingType: row.listing_type,
    status: row.status,
    visibility: row.visibility,
    authorVisibility: row.author_visibility,
    title: row.title,
    description: row.description,
    priceAmount: row.price_amount != null ? Number(row.price_amount) : null,
    priceCurrency: row.price_currency,
    isNegotiable: row.is_negotiable,
    city: row.city,
    state: row.state,
    stateCode: row.state_code ?? null,
    cityGeoid: row.city_geoid ?? null,
    latitude: row.latitude,
    longitude: row.longitude,
    contactPreference: row.contact_preference,
    publisherType: row.publisher_type ?? "profile",
    publisherBusinessId: row.publisher_business_id ?? null,
    publishedAt: row.published_at,
    reservedAt: row.reserved_at,
    completedAt: row.completed_at,
    pausedAt: row.paused_at ?? null,
    archivedAt: row.archived_at ?? null,
    expiresAt: row.expires_at,
    moderationReason: row.moderation_reason ?? null,
    favoritesCount: row.favorites_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    marketplace: details ? mapMarketplaceDetails(details) : null,
    service: serviceDetails ? mapServiceDetails(serviceDetails) : null,
    transfer: transferDetails ? mapTransferDetails(transferDetails) : null,
    lechu: lechuDetails ? mapLechuDetails(lechuDetails) : null,
    media: media.length
      ? media
      : (row.listing_media ?? [])
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((m) => mapMedia(m, null)),
    author: author ?? publisher?.author ?? null,
    publisher: publisher ?? null,
    favoritedByMe,
  };
}

export function mapPublicProfile(
  raw: Record<string, unknown>,
): PublicProfileCard {
  return {
    mode: raw.mode as PublicProfileCard["mode"],
    isSelf: Boolean(raw.is_self),
    ownerId: (raw.owner_id as string | null) ?? (raw.user_id as string | null) ?? null,
    label: String(raw.label ?? "Пользователь"),
    username: (raw.username as string | null) ?? null,
    displayName: (raw.display_name as string | null) ?? null,
    avatarUrl: (raw.avatar_url as string | null) ?? null,
    bio: (raw.bio as string | null) ?? null,
    city: (raw.city as string | null) ?? null,
    state: (raw.state as string | null) ?? null,
    memberSince: String(raw.member_since),
    reviewsPublishedCount: Number(raw.reviews_published_count ?? 0),
    reviewsAiVerifiedCount: Number(raw.reviews_ai_verified_count ?? 0),
    listingsActiveCount: Number(raw.listings_active_count ?? 0),
    listingsCompletedCount: Number(raw.listings_completed_count ?? 0),
    showReviews: Boolean(raw.show_reviews),
    showListings: Boolean(raw.show_listings),
  };
}

export function formatPrice(
  amount: number | null,
  currency: string,
  transactionType?: string,
): string {
  if (transactionType === "free" || amount === 0) return "Бесплатно";
  if (transactionType === "exchange") return "Обмен";
  if (transactionType === "wanted") {
    return amount != null ? `Ищу до $${amount.toFixed(0)}` : "Куплю";
  }
  if (amount == null) return "Цена не указана";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export function formatServicePrice(
  details: Pick<
    ServiceListingDetails,
    "pricingType" | "priceFrom" | "priceTo" | "priceUnit"
  >,
  currency = "USD",
): string {
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: n % 1 === 0 ? 0 : 2,
    }).format(n);

  switch (details.pricingType) {
    case "fixed":
      return details.priceFrom != null ? fmt(details.priceFrom) : "Цена не указана";
    case "from":
      return details.priceFrom != null
        ? `от ${fmt(details.priceFrom)}`
        : "от …";
    case "hourly":
      return details.priceFrom != null
        ? `${fmt(details.priceFrom)}${details.priceUnit ? ` / ${details.priceUnit}` : "/час"}`
        : "Почасовая";
    case "daily":
      return details.priceFrom != null
        ? `${fmt(details.priceFrom)}${details.priceUnit ? ` / ${details.priceUnit}` : "/день"}`
        : "Посуточная";
    case "negotiable":
      return "Договорная";
    case "free_estimate":
      return "Бесплатная оценка";
    case "contact_for_price":
      return "Цена по запросу";
    default:
      return "Цена не указана";
  }
}

export function isCatalogVisible(listing: Pick<Listing, "status" | "visibility">) {
  return listing.status === "active" && listing.visibility === "public";
}

export const USER_EDITABLE_STATUSES: ListingStatus[] = [
  "draft",
  "active",
  "paused",
  "reserved",
  "completed",
  "archived",
];

export const CATALOG_VISIBILITY: ListingVisibility[] = ["public"];
