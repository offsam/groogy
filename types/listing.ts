export type ProfileVisibility = "public" | "private";
export type AuthorVisibility = "public" | "initials" | "anonymous";

export type ListingType =
  | "marketplace_item"
  | "service"
  | "job"
  | "resume"
  | "vehicle"
  | "transfer"
  | "transport_carry";

export type ListingDomain = "marketplace" | "services" | "transfers" | "lechu";

export type TransferMethod = "bank" | "crypto" | "cash" | "other";

export type LechuRewardType = "free" | "paid" | "negotiable";

export type PublisherType = "profile" | "business";

export type ListingStatus =
  | "draft"
  | "active"
  | "paused"
  | "reserved"
  | "completed"
  | "expired"
  | "archived"
  | "removed"
  | "rejected";

export type ListingVisibility = "public" | "unlisted" | "private";

export type ListingCondition =
  | "new"
  | "like_new"
  | "good"
  | "fair"
  | "poor";

export type ListingTransactionType = "sell" | "free" | "exchange" | "wanted";

export type ServicePricingType =
  | "fixed"
  | "from"
  | "hourly"
  | "daily"
  | "negotiable"
  | "free_estimate"
  | "contact_for_price";

export type ServiceMode = "in_person" | "remote" | "mobile" | "hybrid";

export type ListingReportReason =
  | "spam"
  | "fraud"
  | "prohibited_item"
  | "wrong_category"
  | "duplicate"
  | "offensive"
  | "service_in_marketplace"
  | "scam"
  | "prohibited_service"
  | "misleading_information"
  | "unlicensed_claim"
  | "inappropriate_content"
  | "other";

export type ListingReportStatus =
  | "pending"
  | "reviewed"
  | "dismissed"
  | "action_taken";

export type ListingContactPreference =
  | "platform_message"
  | "phone"
  | "email"
  | "any";

export type AuthorDisplay = {
  mode: AuthorVisibility;
  label: string;
  avatarUrl: string | null;
  username: string | null;
  profilePath: string | null;
};

export type ListingPublisher = {
  publisherType: PublisherType;
  businessId: string | null;
  slug: string | null;
  name: string | null;
  logoUrl: string | null;
  author?: AuthorDisplay | null;
};

export type OwnedBusinessOption = {
  id: string;
  name: string;
  slug: string;
  status: string;
};

export type ListingCategory = {
  id: string;
  slug: string;
  nameRu: string;
  nameEn: string | null;
  sortOrder: number;
  domain?: ListingDomain;
};

export type ListingMedia = {
  id: string;
  listingId: string;
  storagePath: string;
  sortOrder: number;
  publicUrl: string | null;
};

export type MarketplaceDetails = {
  categoryId: string | null;
  condition: ListingCondition | null;
  transactionType: ListingTransactionType;
  deliveryAvailable: boolean;
  pickupAvailable: boolean;
  quantity: number | null;
  category?: ListingCategory | null;
};

export type ServiceListingDetails = {
  serviceCategoryId: string | null;
  pricingType: ServicePricingType;
  priceFrom: number | null;
  priceTo: number | null;
  priceUnit: string | null;
  serviceModes: ServiceMode[];
  serviceArea: string | null;
  experienceYears: number | null;
  languages: string[];
  licenseInfo: string | null;
  insuranceStatus: string | null;
  availabilityText: string | null;
  offersFreeEstimate: boolean;
  offersEmergencyService: boolean;
  category?: ListingCategory | null;
};

export type TransferListingDetails = {
  categoryId: string | null;
  fromCountry: string;
  toCountry: string;
  transferMethod: TransferMethod;
  feePercent: number | null;
  feeFixedUsd: number | null;
  minAmountUsd: number | null;
  maxAmountUsd: number | null;
  processingDays: number | null;
  category?: ListingCategory | null;
};

export type LechuListingDetails = {
  categoryId: string | null;
  departureCountry: string;
  destinationCountry: string;
  departureDate: string | null;
  carryTypes: string[];
  maxWeightKg: number | null;
  sizeLimit: string | null;
  rewardType: LechuRewardType;
  category?: ListingCategory | null;
};

export type Listing = {
  id: string;
  ownerId: string;
  listingType: ListingType;
  status: ListingStatus;
  visibility: ListingVisibility;
  authorVisibility: AuthorVisibility;
  title: string;
  description: string;
  priceAmount: number | null;
  priceCurrency: string;
  isNegotiable: boolean;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  cityGeoid: string | null;
  latitude: number | null;
  longitude: number | null;
  contactPreference: ListingContactPreference;
  publisherType: PublisherType;
  publisherBusinessId: string | null;
  /** Original post URL — null on guest SSR; load via source API after auth. */
  sourceUrl: string | null;
  sourceKind: "telegram" | "facebook" | "platform" | null;
  /** Safe flag for locked chip without exposing URL. */
  hasSource: boolean;
  publishedAt: string | null;
  reservedAt: string | null;
  completedAt: string | null;
  pausedAt: string | null;
  archivedAt: string | null;
  expiresAt: string | null;
  moderationReason: string | null;
  favoritesCount: number;
  createdAt: string;
  updatedAt: string;
  marketplace?: MarketplaceDetails | null;
  service?: ServiceListingDetails | null;
  transfer?: TransferListingDetails | null;
  lechu?: LechuListingDetails | null;
  media?: ListingMedia[];
  author?: AuthorDisplay | null;
  publisher?: ListingPublisher | null;
  favoritedByMe?: boolean;
};

export type PublicProfileCard = {
  mode: "public" | "private" | "private_preview";
  isSelf: boolean;
  ownerId: string | null;
  label: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  city: string | null;
  state: string | null;
  memberSince: string;
  reviewsPublishedCount: number;
  reviewsAiVerifiedCount: number;
  listingsActiveCount: number;
  listingsCompletedCount: number;
  showReviews: boolean;
  showListings: boolean;
};

export type ListingSearchParams = {
  categorySlug?: string | null;
  transactionType?: ListingTransactionType | null;
  condition?: ListingCondition | null;
  city?: string | null;
  hubId?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  sort?: "newest" | "price_asc" | "price_desc";
  page?: number;
  pageSize?: number;
};

export type ServicesSearchParams = {
  categorySlug?: string | null;
  city?: string | null;
  hubId?: string | null;
  pricingType?: ServicePricingType | null;
  serviceMode?: ServiceMode | null;
  publisherType?: PublisherType | null;
  freeEstimate?: boolean | null;
  emergency?: boolean | null;
  sort?: "newest" | "price_asc" | "price_desc";
  page?: number;
  pageSize?: number;
};

export type TransfersSearchParams = {
  categorySlug?: string | null;
  fromCountry?: string | null;
  toCountry?: string | null;
  transferMethod?: TransferMethod | null;
  city?: string | null;
  hubId?: string | null;
  sort?: "newest" | "fee_asc" | "fee_desc";
  page?: number;
  pageSize?: number;
};

export type LechuSearchParams = {
  categorySlug?: string | null;
  departureCountry?: string | null;
  destinationCountry?: string | null;
  rewardType?: LechuRewardType | null;
  city?: string | null;
  hubId?: string | null;
  sort?: "newest" | "date_asc" | "date_desc";
  page?: number;
  pageSize?: number;
};

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  draft: "Черновик",
  active: "Активно",
  paused: "На паузе",
  reserved: "Зарезервировано",
  completed: "Завершено",
  expired: "Истекло",
  archived: "В архиве",
  removed: "Удалено модерацией",
  rejected: "Отклонено",
};

export const CONDITION_LABELS: Record<ListingCondition, string> = {
  new: "Новое",
  like_new: "Как новое",
  good: "Хорошее",
  fair: "Нормальное",
  poor: "Сильный износ",
};

export const TRANSACTION_LABELS: Record<ListingTransactionType, string> = {
  sell: "Продажа",
  free: "Бесплатно",
  exchange: "Обмен",
  wanted: "Куплю",
};

export const SERVICE_PRICING_LABELS: Record<ServicePricingType, string> = {
  fixed: "Фиксированная цена",
  from: "От",
  hourly: "Почасовая",
  daily: "Посуточная",
  negotiable: "Договорная",
  free_estimate: "Бесплатная оценка",
  contact_for_price: "Цена по запросу",
};

export const SERVICE_MODE_LABELS: Record<ServiceMode, string> = {
  in_person: "На месте",
  remote: "Онлайн",
  mobile: "С выездом",
  hybrid: "Гибрид",
};

export const TRANSFER_METHOD_LABELS: Record<TransferMethod, string> = {
  bank: "Банковский перевод",
  crypto: "Криптовалюта",
  cash: "Наличные",
  other: "Другое",
};

export const LECHU_REWARD_LABELS: Record<LechuRewardType, string> = {
  free: "Бесплатно",
  paid: "Платно",
  negotiable: "Договорная",
};

export const LECHU_CARRY_TYPE_LABELS: Record<string, string> = {
  documents: "Документы",
  parcels: "Посылки",
  medicine: "Лекарства",
  other: "Другое",
};

export const REPORT_REASON_LABELS: Record<ListingReportReason, string> = {
  spam: "Спам",
  fraud: "Мошенничество",
  prohibited_item: "Запрещённый товар",
  wrong_category: "Неверная категория",
  duplicate: "Дубликат",
  offensive: "Оскорбления",
  service_in_marketplace: "Это услуга, не товар",
  scam: "Мошенническая схема",
  prohibited_service: "Запрещённая услуга",
  misleading_information: "Вводящая в заблуждение информация",
  unlicensed_claim: "Ложное заявление о лицензии",
  inappropriate_content: "Неприемлемый контент",
  other: "Другое",
};

/** Marketplace report reasons shown in the UI. */
export const MARKETPLACE_REPORT_REASONS: ListingReportReason[] = [
  "spam",
  "fraud",
  "prohibited_item",
  "wrong_category",
  "duplicate",
  "offensive",
  "service_in_marketplace",
  "other",
];

/** Services report reasons shown in the UI. */
export const SERVICE_REPORT_REASONS: ListingReportReason[] = [
  "spam",
  "scam",
  "prohibited_service",
  "misleading_information",
  "unlicensed_claim",
  "inappropriate_content",
  "duplicate",
  "other",
];

export const MIN_TITLE = 3;
export const MAX_TITLE = 120;
export const MIN_DESCRIPTION = 10;
export const MAX_DESCRIPTION = 8000;
export const MAX_MEDIA = 10;
export const MAX_BIO = 1000;
export const USERNAME_RE = /^[a-z0-9_]{3,30}$/;
