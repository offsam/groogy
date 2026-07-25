import type {
  AuthorVisibility,
  ListingCondition,
  ListingStatus,
  ListingTransactionType,
  ListingType,
  ListingVisibility,
  ServiceMode,
  ServicePricingType,
} from "@/types/listing";

export const LISTING_PAGE_SIZE = 12;
export const MAX_LISTING_MEDIA = 10;
export const LISTING_IMAGES_BUCKET = "listing-images";

/** Marketplace (and non-service) user status transitions. */
export const USER_STATUS_TRANSITIONS: Record<
  ListingStatus,
  ListingStatus[]
> = {
  draft: ["active", "archived"],
  active: ["reserved", "completed", "archived"],
  paused: [],
  reserved: ["active", "completed", "archived"],
  completed: ["archived"],
  expired: [],
  archived: ["draft"],
  removed: [],
  rejected: [],
};

/** Service listings: pause/reactivate; no reserved. */
export const SERVICE_USER_STATUS_TRANSITIONS: Record<
  ListingStatus,
  ListingStatus[]
> = {
  draft: ["active", "archived"],
  active: ["paused", "completed", "archived"],
  paused: ["active", "archived"],
  reserved: [],
  completed: ["active", "archived"],
  expired: [],
  archived: ["draft"],
  removed: [],
  rejected: [],
};

export function statusTransitionsForType(
  listingType: ListingType,
): Record<ListingStatus, ListingStatus[]> {
  return listingType === "service" ||
    listingType === "transfer" ||
    listingType === "transport_carry"
    ? SERVICE_USER_STATUS_TRANSITIONS
    : USER_STATUS_TRANSITIONS;
}

export const AUTHOR_VISIBILITY_OPTIONS: {
  value: AuthorVisibility;
  label: string;
}[] = [
  { value: "public", label: "Полное имя" },
  { value: "initials", label: "Инициалы" },
  { value: "anonymous", label: "Анонимно" },
];

export const LISTING_VISIBILITY_OPTIONS: {
  value: ListingVisibility;
  label: string;
  hint: string;
}[] = [
  {
    value: "public",
    label: "Публичное",
    hint: "Видно в каталоге",
  },
  {
    value: "unlisted",
    label: "По ссылке",
    hint: "Не в каталоге, доступно по прямой ссылке",
  },
  {
    value: "private",
    label: "Приватное",
    hint: "Только вы и администраторы",
  },
];

export const CONDITION_OPTIONS: { value: ListingCondition; label: string }[] = [
  { value: "new", label: "Новое" },
  { value: "like_new", label: "Как новое" },
  { value: "good", label: "Хорошее" },
  { value: "fair", label: "Нормальное" },
  { value: "poor", label: "Сильный износ" },
];

export const TRANSACTION_OPTIONS: {
  value: ListingTransactionType;
  label: string;
}[] = [
  { value: "sell", label: "Продажа" },
  { value: "free", label: "Бесплатно" },
  { value: "exchange", label: "Обмен" },
  { value: "wanted", label: "Куплю" },
];

export const SERVICE_PRICING_OPTIONS: {
  value: ServicePricingType;
  label: string;
}[] = [
  { value: "fixed", label: "Фиксированная цена" },
  { value: "from", label: "От" },
  { value: "hourly", label: "Почасовая" },
  { value: "daily", label: "Посуточная" },
  { value: "negotiable", label: "Договорная" },
  { value: "free_estimate", label: "Бесплатная оценка" },
  { value: "contact_for_price", label: "Цена по запросу" },
];

export const SERVICE_MODE_OPTIONS: {
  value: ServiceMode;
  label: string;
}[] = [
  { value: "in_person", label: "На месте" },
  { value: "remote", label: "Онлайн" },
  { value: "mobile", label: "С выездом" },
  { value: "hybrid", label: "Гибрид" },
];

export const LANGUAGE_OPTIONS = [
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
] as const;

export function listingStoragePrefix(ownerId: string, listingId: string) {
  return `listings/${ownerId}/${listingId}`;
}

export function isPublisherLocked(listing: {
  publishedAt: string | null;
  status: ListingStatus;
}) {
  return listing.publishedAt != null || listing.status !== "draft";
}
