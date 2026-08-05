import type {
  BusinessOfferAttributes,
  BusinessOfferPriceMode,
  BusinessOfferStatus,
  BusinessOfferType,
  BusinessOfferVisibility,
} from "@/types/business-offer";
import { slugifyOfferTitle } from "@/types/business-offer";

export type OfferFormInput = {
  businessId: string;
  offerType: BusinessOfferType;
  title: string;
  slug?: string;
  shortDescription?: string | null;
  description?: string | null;
  categoryId?: string | null;
  status?: BusinessOfferStatus;
  visibility?: BusinessOfferVisibility;
  priceMode: BusinessOfferPriceMode;
  priceAmount?: number | null;
  priceMin?: number | null;
  priceMax?: number | null;
  currency?: string;
  priceUnit?: string | null;
  primaryImageUrl?: string | null;
  sortOrder?: number;
  isFeatured?: boolean;
  isAvailable?: boolean;
  attributes?: BusinessOfferAttributes;
};

const ALLOWED_ATTRS: Record<BusinessOfferType, string[]> = {
  service: ["duration", "service_area", "booking_required", "mobile_service", "warranty"],
  product: ["sku", "condition", "inventory_status", "quantity", "brand", "model"],
  vehicle: [
    "year",
    "make",
    "model",
    "trim",
    "mileage",
    "vin",
    "condition",
    "body_type",
    "fuel_type",
    "transmission",
    "exterior_color",
  ],
  property: [
    "listing_type",
    "property_type",
    "address",
    "city",
    "state",
    "zip",
    "bedrooms",
    "bathrooms",
    "sqft",
    "lot_size",
    "year_built",
    "mls_number",
  ],
  rental: [
    "rental_period",
    "deposit_amount",
    "minimum_duration",
    "availability_note",
    "capacity",
  ],
  menu_item: ["ingredients", "dietary_tags", "portion", "spice_level", "menu_section"],
  other: [],
};

export function sanitizeOfferAttributes(
  offerType: BusinessOfferType,
  raw: BusinessOfferAttributes | undefined,
): BusinessOfferAttributes {
  const allowed = ALLOWED_ATTRS[offerType];
  const out: BusinessOfferAttributes = {};
  if (!raw || typeof raw !== "object") return out;

  for (const key of allowed) {
    const val = (raw as Record<string, unknown>)[key];
    if (val === undefined || val === null || val === "") continue;
    (out as Record<string, unknown>)[key] = val;
  }
  return out;
}

export function normalizeOfferInput(input: OfferFormInput): OfferFormInput {
  const title = input.title.trim();
  const slug = (input.slug?.trim() || slugifyOfferTitle(title)).slice(0, 80);

  return {
    ...input,
    title,
    slug,
    shortDescription: input.shortDescription?.trim() || null,
    description: input.description?.trim() || null,
    currency: input.currency?.trim() || "USD",
    priceUnit: input.priceUnit?.trim() || null,
    primaryImageUrl: input.primaryImageUrl?.trim() || null,
    attributes: sanitizeOfferAttributes(input.offerType, input.attributes),
  };
}

export function validateOfferInput(input: OfferFormInput): string | null {
  if (input.title.length < 2 || input.title.length > 160) {
    return "Название: от 2 до 160 символов.";
  }
  if (!input.slug || input.slug.length < 2) {
    return "Укажите корректный slug.";
  }
  if (input.shortDescription && input.shortDescription.length > 300) {
    return "Краткое описание: до 300 символов.";
  }
  if (input.description && input.description.length > 8000) {
    return "Описание: до 8000 символов.";
  }

  switch (input.priceMode) {
    case "fixed":
      if (input.priceAmount == null || input.priceAmount < 0) {
        return "Укажите фиксированную цену.";
      }
      break;
    case "from":
      if (
        (input.priceAmount == null || input.priceAmount < 0) &&
        (input.priceMin == null || input.priceMin < 0)
      ) {
        return "Укажите минимальную цену «от».";
      }
      break;
    case "range":
      if (
        input.priceMin == null ||
        input.priceMax == null ||
        input.priceMin < 0 ||
        input.priceMax < input.priceMin
      ) {
        return "Укажите корректный диапазон цен.";
      }
      break;
    default:
      break;
  }

  return null;
}

export function offerToDbRow(input: OfferFormInput) {
  const normalized = normalizeOfferInput(input);
  return {
    business_id: normalized.businessId,
    offer_type: normalized.offerType,
    title: normalized.title,
    slug: normalized.slug!,
    short_description: normalized.shortDescription,
    description: normalized.description,
    category_id: normalized.categoryId ?? null,
    status: normalized.status ?? "draft",
    visibility: normalized.visibility ?? "public",
    price_mode: normalized.priceMode,
    price_amount: normalized.priceAmount ?? null,
    price_min: normalized.priceMin ?? null,
    price_max: normalized.priceMax ?? null,
    currency: normalized.currency ?? "USD",
    price_unit: normalized.priceUnit,
    primary_image_url: normalized.primaryImageUrl,
    sort_order: normalized.sortOrder ?? 0,
    is_featured: normalized.isFeatured ?? false,
    is_available: normalized.isAvailable ?? true,
    attributes: normalized.attributes ?? {},
  };
}

export const ATTRIBUTE_FIELDS: Record<
  BusinessOfferType,
  { key: string; label: string; type: "text" | "number" | "boolean" | "select" | "tags" }[]
> = {
  service: [
    { key: "duration", label: "Длительность", type: "text" },
    { key: "service_area", label: "Зона обслуживания", type: "text" },
    { key: "booking_required", label: "Требуется запись", type: "boolean" },
    { key: "mobile_service", label: "Выезд на дом", type: "boolean" },
    { key: "warranty", label: "Гарантия", type: "text" },
  ],
  product: [
    { key: "sku", label: "SKU", type: "text" },
    { key: "brand", label: "Бренд", type: "text" },
    { key: "model", label: "Модель", type: "text" },
    { key: "condition", label: "Состояние", type: "text" },
    { key: "inventory_status", label: "Наличие", type: "text" },
    { key: "quantity", label: "Количество", type: "number" },
  ],
  vehicle: [
    { key: "year", label: "Год", type: "number" },
    { key: "make", label: "Марка", type: "text" },
    { key: "model", label: "Модель", type: "text" },
    { key: "trim", label: "Комплектация", type: "text" },
    { key: "mileage", label: "Пробег", type: "number" },
    { key: "vin", label: "VIN", type: "text" },
    { key: "condition", label: "Состояние", type: "text" },
    { key: "body_type", label: "Кузов", type: "text" },
    { key: "fuel_type", label: "Топливо", type: "text" },
    { key: "transmission", label: "КПП", type: "text" },
    { key: "exterior_color", label: "Цвет", type: "text" },
  ],
  property: [
    { key: "listing_type", label: "Тип сделки", type: "select" },
    { key: "property_type", label: "Тип объекта", type: "text" },
    { key: "address", label: "Адрес", type: "text" },
    { key: "city", label: "Город", type: "text" },
    { key: "state", label: "Штат", type: "text" },
    { key: "zip", label: "ZIP", type: "text" },
    { key: "bedrooms", label: "Спальни", type: "number" },
    { key: "bathrooms", label: "Ванные", type: "number" },
    { key: "sqft", label: "Площадь (sq ft)", type: "number" },
    { key: "lot_size", label: "Участок", type: "text" },
    { key: "year_built", label: "Год постройки", type: "number" },
    { key: "mls_number", label: "MLS #", type: "text" },
  ],
  rental: [
    { key: "rental_period", label: "Период аренды", type: "text" },
    { key: "deposit_amount", label: "Депозит", type: "number" },
    { key: "minimum_duration", label: "Мин. срок", type: "text" },
    { key: "availability_note", label: "Доступность", type: "text" },
    { key: "capacity", label: "Вместимость", type: "text" },
  ],
  menu_item: [
    { key: "ingredients", label: "Ингредиенты", type: "text" },
    { key: "dietary_tags", label: "Диетические метки", type: "tags" },
    { key: "portion", label: "Порция", type: "text" },
    { key: "spice_level", label: "Острота", type: "text" },
  ],
  other: [],
};
