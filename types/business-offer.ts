export type BusinessOfferType =
  | "service"
  | "product"
  | "vehicle"
  | "property"
  | "rental"
  | "menu_item"
  | "other";

export type BusinessOfferStatus = "draft" | "active" | "archived";

export type BusinessOfferVisibility = "public" | "unlisted";

export type BusinessOfferPriceMode =
  | "fixed"
  | "from"
  | "range"
  | "on_request"
  | "free"
  | "contact";

export type BusinessOfferPriceUnit =
  | "item"
  | "hour"
  | "day"
  | "week"
  | "month"
  | "visit"
  | "service"
  | "person"
  | "mile"
  | "sqft"
  | "lb"
  | "package"
  | "custom";

export type ServiceOfferAttributes = {
  duration?: string | null;
  service_area?: string | null;
  booking_required?: boolean | null;
  mobile_service?: boolean | null;
  warranty?: string | null;
};

export type ProductOfferAttributes = {
  sku?: string | null;
  condition?: string | null;
  inventory_status?: string | null;
  quantity?: number | null;
  brand?: string | null;
  model?: string | null;
};

export type VehicleOfferAttributes = {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  mileage?: number | null;
  vin?: string | null;
  condition?: string | null;
  body_type?: string | null;
  fuel_type?: string | null;
  transmission?: string | null;
  exterior_color?: string | null;
};

export type PropertyOfferAttributes = {
  listing_type?: "sale" | "rent" | "lease" | null;
  property_type?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
  lot_size?: string | null;
  year_built?: number | null;
  mls_number?: string | null;
};

export type RentalOfferAttributes = {
  rental_period?: string | null;
  deposit_amount?: number | null;
  minimum_duration?: string | null;
  availability_note?: string | null;
  capacity?: string | null;
};

export type MenuItemOfferAttributes = {
  ingredients?: string | null;
  dietary_tags?: string[] | null;
  portion?: string | null;
  spice_level?: string | null;
};

export type BusinessOfferAttributes =
  | ServiceOfferAttributes
  | ProductOfferAttributes
  | VehicleOfferAttributes
  | PropertyOfferAttributes
  | RentalOfferAttributes
  | MenuItemOfferAttributes
  | Record<string, unknown>;

export type BusinessOfferMedia = {
  id: string;
  offerId: string;
  storagePath: string;
  sortOrder: number;
  altText: string | null;
  publicUrl: string | null;
};

export type BusinessOffer = {
  id: string;
  businessId: string;
  businessSlug?: string | null;
  businessName?: string | null;
  offerType: BusinessOfferType;
  title: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  subcategoryId: string | null;
  status: BusinessOfferStatus;
  visibility: BusinessOfferVisibility;
  priceMode: BusinessOfferPriceMode;
  priceAmount: number | null;
  priceMin: number | null;
  priceMax: number | null;
  currency: string;
  priceUnit: BusinessOfferPriceUnit | string | null;
  primaryImageUrl: string | null;
  sortOrder: number;
  isFeatured: boolean;
  isAvailable: boolean;
  attributes: BusinessOfferAttributes;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  media?: BusinessOfferMedia[];
  /** Presence of parent business (Google / Instagram badges). */
  presence?: {
    website?: string | null;
    instagramUrl?: string | null;
    googleMapsUrl?: string | null;
    googleRating?: number | null;
    googleReviewsCount?: number | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
};

export const OFFER_TYPE_LABELS: Record<BusinessOfferType, string> = {
  service: "Услуги",
  product: "Товары",
  vehicle: "Автомобили",
  property: "Объекты",
  rental: "Аренда",
  menu_item: "Меню",
  other: "Предложения",
};

export const OFFER_TYPE_SINGULAR: Record<BusinessOfferType, string> = {
  service: "Услуга",
  product: "Товар",
  vehicle: "Автомобиль",
  property: "Объект",
  rental: "Аренда",
  menu_item: "Блюдо",
  other: "Предложение",
};

export const OFFER_STATUS_LABELS: Record<BusinessOfferStatus, string> = {
  draft: "Черновик",
  active: "Опубликовано",
  archived: "В архиве",
};

export const OFFER_PRICE_MODE_LABELS: Record<BusinessOfferPriceMode, string> = {
  fixed: "Фиксированная",
  from: "От",
  range: "Диапазон",
  on_request: "По запросу",
  free: "Бесплатно",
  contact: "Связаться",
};

export const OFFER_PRICE_UNIT_LABELS: Record<string, string> = {
  item: "за шт.",
  hour: "за час",
  day: "за день",
  week: "за нед.",
  month: "за мес.",
  visit: "за визит",
  service: "за услугу",
  person: "за чел.",
  mile: "за милю",
  sqft: "за sq ft",
  lb: "за lb",
  package: "за пакет",
  custom: "",
};

export function slugifyOfferTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
