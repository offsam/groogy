import {
  MAX_BIO,
  MAX_DESCRIPTION,
  MAX_TITLE,
  MIN_DESCRIPTION,
  MIN_TITLE,
  USERNAME_RE,
  type AuthorVisibility,
  type ListingCondition,
  type ListingStatus,
  type ListingTransactionType,
  type ListingType,
  type ListingVisibility,
  type ListingReportReason,
  type PublisherType,
  type ServiceMode,
  type ServicePricingType,
  type TransferMethod,
  type LechuRewardType,
} from "@/types/listing";
import { statusTransitionsForType } from "@/lib/listings/constants";

export type ListingFormInput = {
  title: string;
  description: string;
  priceAmount: number | null;
  isNegotiable: boolean;
  city: string | null;
  state: string | null;
  stateCode?: string | null;
  cityGeoid?: string | null;
  visibility: ListingVisibility;
  authorVisibility: AuthorVisibility;
  categoryId: string | null;
  condition: ListingCondition | null;
  transactionType: ListingTransactionType;
  deliveryAvailable: boolean;
  pickupAvailable: boolean;
  quantity: number | null;
  publisherType: PublisherType;
  publisherBusinessId: string | null;
};

export type ServiceFormInput = {
  title: string;
  description: string;
  city: string | null;
  state: string | null;
  stateCode?: string | null;
  cityGeoid?: string | null;
  visibility: ListingVisibility;
  authorVisibility: AuthorVisibility;
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
  isNegotiable: boolean;
  publisherType: PublisherType;
  publisherBusinessId: string | null;
};

export type TransferFormInput = {
  title: string;
  description: string;
  city: string | null;
  state: string | null;
  stateCode?: string | null;
  cityGeoid?: string | null;
  visibility: ListingVisibility;
  authorVisibility: AuthorVisibility;
  categoryId: string | null;
  fromCountry: string;
  toCountry: string;
  transferMethod: TransferMethod;
  feePercent: number | null;
  feeFixedUsd: number | null;
  minAmountUsd: number | null;
  maxAmountUsd: number | null;
  processingDays: number | null;
  contactNote: string | null;
  publisherType: PublisherType;
  publisherBusinessId: string | null;
};

export type LechuFormInput = {
  title: string;
  description: string;
  city: string | null;
  state: string | null;
  stateCode?: string | null;
  cityGeoid?: string | null;
  visibility: ListingVisibility;
  authorVisibility: AuthorVisibility;
  categoryId: string | null;
  departureCountry: string;
  destinationCountry: string;
  departureDate: string | null;
  carryTypes: string[];
  maxWeightKg: number | null;
  sizeLimit: string | null;
  rewardType: LechuRewardType;
  contactNote: string | null;
  publisherType: PublisherType;
  publisherBusinessId: string | null;
};

export type ProfileFormInput = {
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  bio: string | null;
  city: string | null;
  state: string | null;
  profileVisibility: "public" | "private";
  defaultAuthorVisibility: AuthorVisibility;
  publicActivityEnabled: boolean;
  showReviewsInProfile: boolean;
  showListingsInProfile: boolean;
};

const SERVICE_LOOKS_ALLOW = [
  /(service history|fully (serviced|repaired)|professionally repaired|repaired (item|phone|laptop|device))/i,
  /(installation manual|install(ation)? instructions|user manual)/i,
];

const SERVICE_LOOKS_STRONG = [
  /(call for (a )?estimate|free estimate|get a quote|request a quote)/i,
  /(hourly rate|\$ ?\/ ?(hour|hr)|per hour|\/час|в час)/i,
  /(i (offer|provide|do) (services?|repairs?)|offering (my )?services?|hire me)/i,
  /\b(book (an? )?(appointment|session)|schedule a visit|выезд на дом|работаю по записи)\b/i,
];

const SERVICE_LOOKS_RU = [
  /(установка|монтаж|ремонт под ключ|вызов (мастера|специалиста)|консультаци[яи]|смет[аы]|прайс за (час|выезд))/i,
];

const SERVICE_TITLE_EN =
  /^(repair|fixing|handyman|plumbing|electrical|cleaning|tutoring|massage)\b/i;
const SERVICE_TITLE_RU =
  /^(ремонт|установка|сантехник|электрик|уборк|репетитор|маникюр|парикмахер)\b/i;

/**
 * Conservative mirror of public.marketplace_looks_like_service.
 * Prefer false-negatives over blocking legitimate goods.
 */
export function validateMarketplaceNotService(
  title: string,
  description: string,
): string | null {
  const t = title.toLowerCase();
  const d = description.toLowerCase();
  const blob = `${t} ${d}`;

  for (const re of SERVICE_LOOKS_ALLOW) {
    if (re.test(blob)) return null;
  }

  for (const re of SERVICE_LOOKS_STRONG) {
    if (re.test(blob)) {
      return "Похоже на услугу. Разместите объявление в разделе Услуги.";
    }
  }

  for (const re of SERVICE_LOOKS_RU) {
    if (re.test(blob) && !/(установочн|installation kit|mount(ing)? kit|кронштейн)/i.test(blob)) {
      return "Похоже на услугу. Разместите объявление в разделе Услуги.";
    }
  }

  if (SERVICE_TITLE_EN.test(t) || SERVICE_TITLE_RU.test(t)) {
    return "Похоже на услугу. Разместите объявление в разделе Услуги.";
  }

  return null;
}

export function validateListingDraft(input: ListingFormInput): string | null {
  const title = input.title.trim();
  const description = input.description.trim();

  if (title.length < MIN_TITLE || title.length > MAX_TITLE) {
    return `Заголовок: от ${MIN_TITLE} до ${MAX_TITLE} символов.`;
  }
  if (description.length < MIN_DESCRIPTION || description.length > MAX_DESCRIPTION) {
    return `Описание: от ${MIN_DESCRIPTION} до ${MAX_DESCRIPTION} символов.`;
  }
  if (input.priceAmount != null && input.priceAmount < 0) {
    return "Цена не может быть отрицательной.";
  }
  if (
    !["public", "unlisted", "private"].includes(input.visibility)
  ) {
    return "Некорректная видимость объявления.";
  }
  if (
    !["public", "initials", "anonymous"].includes(input.authorVisibility)
  ) {
    return "Некорректный режим отображения автора.";
  }
  if (
    !["sell", "free", "exchange", "wanted"].includes(input.transactionType)
  ) {
    return "Некорректный тип сделки.";
  }
  if (
    input.condition != null &&
    !["new", "like_new", "good", "fair", "poor"].includes(input.condition)
  ) {
    return "Некорректное состояние товара.";
  }
  if (input.quantity != null && (!Number.isInteger(input.quantity) || input.quantity < 1)) {
    return "Количество должно быть целым числом ≥ 1.";
  }
  const publisherError = validatePublisherFields(
    input.publisherType,
    input.publisherBusinessId,
  );
  if (publisherError) return publisherError;
  return null;
}

export function validateListingPublish(input: ListingFormInput): string | null {
  const draftError = validateListingDraft(input);
  if (draftError) return draftError;

  if (!input.city?.trim() || !input.state?.trim()) {
    return "Для публикации укажите город и штат.";
  }
  if (!input.categoryId) {
    return "Выберите категорию.";
  }
  if (input.transactionType === "sell") {
    if (input.priceAmount == null || input.priceAmount < 0) {
      return "Укажите цену для продажи.";
    }
  }
  if (input.transactionType !== "wanted" && !input.condition) {
    return "Укажите состояние товара.";
  }

  const serviceHint = validateMarketplaceNotService(input.title, input.description);
  if (serviceHint) return serviceHint;

  return null;
}

export function validatePublisherFields(
  publisherType: PublisherType,
  publisherBusinessId: string | null,
): string | null {
  if (!["profile", "business"].includes(publisherType)) {
    return "Некорректный тип публикатора.";
  }
  if (publisherType === "profile" && publisherBusinessId) {
    return "Для личного профиля бизнес не указывается.";
  }
  if (publisherType === "business" && !publisherBusinessId) {
    return "Выберите бизнес для публикации.";
  }
  return null;
}

export function validateServiceDraft(input: ServiceFormInput): string | null {
  const title = input.title.trim();
  const description = input.description.trim();

  if (title.length < MIN_TITLE || title.length > MAX_TITLE) {
    return `Заголовок: от ${MIN_TITLE} до ${MAX_TITLE} символов.`;
  }
  if (description.length < MIN_DESCRIPTION || description.length > MAX_DESCRIPTION) {
    return `Описание: от ${MIN_DESCRIPTION} до ${MAX_DESCRIPTION} символов.`;
  }
  if (
    !["public", "unlisted", "private"].includes(input.visibility)
  ) {
    return "Некорректная видимость объявления.";
  }
  if (
    !["public", "initials", "anonymous"].includes(input.authorVisibility)
  ) {
    return "Некорректный режим отображения автора.";
  }
  const pricingTypes: ServicePricingType[] = [
    "fixed",
    "from",
    "hourly",
    "daily",
    "negotiable",
    "free_estimate",
    "contact_for_price",
  ];
  if (!pricingTypes.includes(input.pricingType)) {
    return "Некорректный тип цены.";
  }
  if (input.priceFrom != null && input.priceFrom < 0) {
    return "Цена не может быть отрицательной.";
  }
  if (input.priceTo != null && input.priceTo < 0) {
    return "Верхняя граница цены не может быть отрицательной.";
  }
  if (
    input.priceFrom != null &&
    input.priceTo != null &&
    input.priceTo < input.priceFrom
  ) {
    return "Верхняя граница цены должна быть ≥ нижней.";
  }
  if (input.serviceModes.length < 1) {
    return "Выберите хотя бы один формат услуги.";
  }
  const allowedModes: ServiceMode[] = ["in_person", "remote", "mobile", "hybrid"];
  if (input.serviceModes.some((m) => !allowedModes.includes(m))) {
    return "Некорректный формат услуги.";
  }
  if (input.languages.length < 1) {
    return "Укажите хотя бы один язык.";
  }
  if (
    input.experienceYears != null &&
    (!Number.isInteger(input.experienceYears) ||
      input.experienceYears < 0 ||
      input.experienceYears > 80)
  ) {
    return "Опыт: целое число от 0 до 80.";
  }
  if (input.priceUnit && input.priceUnit.trim().length > 40) {
    return "Единица цены: максимум 40 символов.";
  }
  if (input.serviceArea && input.serviceArea.trim().length > 200) {
    return "Зона обслуживания: максимум 200 символов.";
  }
  if (input.licenseInfo && input.licenseInfo.length > 500) {
    return "Лицензия: максимум 500 символов.";
  }
  if (input.insuranceStatus && input.insuranceStatus.length > 200) {
    return "Страховка: максимум 200 символов.";
  }
  if (input.availabilityText && input.availabilityText.length > 500) {
    return "Доступность: максимум 500 символов.";
  }
  return validatePublisherFields(input.publisherType, input.publisherBusinessId);
}

export function validateServicePublish(input: ServiceFormInput): string | null {
  const draftError = validateServiceDraft(input);
  if (draftError) return draftError;

  if (!input.city?.trim() || !input.state?.trim()) {
    return "Для публикации укажите город и штат.";
  }
  if (!input.serviceCategoryId) {
    return "Выберите категорию услуги.";
  }
  if (
    ["fixed", "from", "hourly", "daily"].includes(input.pricingType) &&
    input.priceFrom == null
  ) {
    return "Укажите цену для выбранного типа тарифа.";
  }
  return null;
}

export function normalizeListingInput(input: ListingFormInput): ListingFormInput {
  const transactionType = input.transactionType;
  let priceAmount = input.priceAmount;
  if (transactionType === "free") {
    priceAmount = 0;
  }
  const publisherType = input.publisherType ?? "profile";
  return {
    ...input,
    title: input.title.trim(),
    description: input.description.trim(),
    city: input.city?.trim() || null,
    state: input.state?.trim() || null,
    stateCode: input.stateCode?.trim() || null,
    cityGeoid: input.cityGeoid?.trim() || null,
    priceAmount,
    publisherType,
    publisherBusinessId:
      publisherType === "business" ? input.publisherBusinessId : null,
  };
}

export function normalizeServiceInput(input: ServiceFormInput): ServiceFormInput {
  const publisherType = input.publisherType ?? "profile";
  return {
    ...input,
    title: input.title.trim(),
    description: input.description.trim(),
    city: input.city?.trim() || null,
    state: input.state?.trim() || null,
    stateCode: input.stateCode?.trim() || null,
    cityGeoid: input.cityGeoid?.trim() || null,
    priceUnit: input.priceUnit?.trim() || null,
    serviceArea: input.serviceArea?.trim() || null,
    licenseInfo: input.licenseInfo?.trim() || null,
    insuranceStatus: input.insuranceStatus?.trim() || null,
    availabilityText: input.availabilityText?.trim() || null,
    serviceModes: input.serviceModes.length ? input.serviceModes : ["in_person"],
    languages: input.languages.length ? input.languages : ["ru"],
    publisherType,
    publisherBusinessId:
      publisherType === "business" ? input.publisherBusinessId : null,
  };
}

export function canUserTransition(
  from: ListingStatus,
  to: ListingStatus,
  listingType: ListingType = "marketplace_item",
): boolean {
  return statusTransitionsForType(listingType)[from]?.includes(to) ?? false;
}

export const RESERVED_USERNAMES = new Set([
  "admin",
  "profile",
  "marketplace",
  "services",
  "transfers",
  "lechu",
  "business",
  "auth",
  "api",
  "login",
  "signup",
  "settings",
  "support",
  "root",
  "system",
  "moderator",
  "register",
  "u",
  "search",
  "null",
  "undefined",
]);

export function validateProfileInput(input: ProfileFormInput): string | null {
  if (input.displayName != null) {
    const name = input.displayName.trim();
    if (name.length === 0) {
      // allow clearing via null later
    } else if (name.length > 80) {
      return "Имя: максимум 80 символов.";
    }
  }
  if (input.username != null && input.username.trim() !== "") {
    const username = input.username.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) {
      return "Username: 3–30 символов, латиница, цифры и _.";
    }
    if (RESERVED_USERNAMES.has(username)) {
      return "Этот username зарезервирован.";
    }
  }
  if (input.bio != null && input.bio.length > MAX_BIO) {
    return `О себе: максимум ${MAX_BIO} символов.`;
  }
  if (input.city != null && input.city.trim().length > 80) {
    return "Город слишком длинный.";
  }
  if (input.state != null && input.state.trim().length > 40) {
    return "Штат слишком длинный.";
  }
  if (!["public", "private"].includes(input.profileVisibility)) {
    return "Некорректная видимость профиля.";
  }
  if (
    !["public", "initials", "anonymous"].includes(input.defaultAuthorVisibility)
  ) {
    return "Некорректный режим автора по умолчанию.";
  }
  if (input.avatarUrl != null && input.avatarUrl.trim().length > 500) {
    return "Слишком длинный URL аватара.";
  }
  return null;
}

export function normalizeProfileInput(input: ProfileFormInput): ProfileFormInput {
  const usernameRaw = input.username?.trim().toLowerCase() || null;
  return {
    ...input,
    displayName: input.displayName?.trim() || null,
    username: usernameRaw,
    avatarUrl: input.avatarUrl?.trim() || null,
    bio: input.bio?.trim() || null,
    city: input.city?.trim() || null,
    state: input.state?.trim() || null,
  };
}

export function validateTransferDraft(input: TransferFormInput): string | null {
  const title = input.title.trim();
  const description = input.description.trim();
  if (title.length < MIN_TITLE || title.length > MAX_TITLE) {
    return `Заголовок: от ${MIN_TITLE} до ${MAX_TITLE} символов.`;
  }
  if (description.length < MIN_DESCRIPTION || description.length > MAX_DESCRIPTION) {
    return `Описание: от ${MIN_DESCRIPTION} до ${MAX_DESCRIPTION} символов.`;
  }
  if (!["public", "unlisted", "private"].includes(input.visibility)) {
    return "Некорректная видимость объявления.";
  }
  if (!["public", "initials", "anonymous"].includes(input.authorVisibility)) {
    return "Некорректный режим отображения автора.";
  }
  if (!["bank", "crypto", "cash", "other"].includes(input.transferMethod)) {
    return "Некорректный способ перевода.";
  }
  if (input.fromCountry.trim().length < 2 || input.toCountry.trim().length < 2) {
    return "Укажите страны отправления и получения.";
  }
  for (const [label, value] of [
    ["Комиссия %", input.feePercent],
    ["Фикс. комиссия", input.feeFixedUsd],
    ["Мин. сумма", input.minAmountUsd],
    ["Макс. сумма", input.maxAmountUsd],
  ] as const) {
    if (value != null && value < 0) return `${label} не может быть отрицательной.`;
  }
  if (
    input.minAmountUsd != null &&
    input.maxAmountUsd != null &&
    input.maxAmountUsd < input.minAmountUsd
  ) {
    return "Максимальная сумма должна быть ≥ минимальной.";
  }
  if (
    input.processingDays != null &&
    (!Number.isInteger(input.processingDays) || input.processingDays < 0)
  ) {
    return "Срок перевода: целое число дней ≥ 0.";
  }
  return validatePublisherFields(input.publisherType, input.publisherBusinessId);
}

export function validateTransferPublish(input: TransferFormInput): string | null {
  const draftError = validateTransferDraft(input);
  if (draftError) return draftError;
  if (!input.categoryId) return "Выберите категорию маршрута.";
  return null;
}

export function normalizeTransferInput(input: TransferFormInput): TransferFormInput {
  return {
    ...input,
    title: input.title.trim(),
    description: input.description.trim(),
    city: input.city?.trim() || null,
    state: input.state?.trim() || null,
    fromCountry: input.fromCountry.trim(),
    toCountry: input.toCountry.trim(),
    contactNote: input.contactNote?.trim() || null,
  };
}

export function validateLechuDraft(input: LechuFormInput): string | null {
  const title = input.title.trim();
  const description = input.description.trim();
  if (title.length < MIN_TITLE || title.length > MAX_TITLE) {
    return `Заголовок: от ${MIN_TITLE} до ${MAX_TITLE} символов.`;
  }
  if (description.length < MIN_DESCRIPTION || description.length > MAX_DESCRIPTION) {
    return `Описание: от ${MIN_DESCRIPTION} до ${MAX_DESCRIPTION} символов.`;
  }
  if (!["public", "unlisted", "private"].includes(input.visibility)) {
    return "Некорректная видимость объявления.";
  }
  if (!["public", "initials", "anonymous"].includes(input.authorVisibility)) {
    return "Некорректный режим отображения автора.";
  }
  if (!["free", "paid", "negotiable"].includes(input.rewardType)) {
    return "Некорректный тип вознаграждения.";
  }
  if (
    input.departureCountry.trim().length < 2 ||
    input.destinationCountry.trim().length < 2
  ) {
    return "Укажите страны вылета и прибытия.";
  }
  if (input.carryTypes.length < 1) {
    return "Выберите хотя бы один тип груза.";
  }
  if (input.maxWeightKg != null && input.maxWeightKg < 0) {
    return "Вес не может быть отрицательным.";
  }
  if (input.sizeLimit && input.sizeLimit.trim().length > 200) {
    return "Ограничение по размеру: максимум 200 символов.";
  }
  return validatePublisherFields(input.publisherType, input.publisherBusinessId);
}

export function validateLechuPublish(input: LechuFormInput): string | null {
  const draftError = validateLechuDraft(input);
  if (draftError) return draftError;
  if (!input.categoryId) return "Выберите категорию маршрута.";
  return null;
}

export function normalizeLechuInput(input: LechuFormInput): LechuFormInput {
  return {
    ...input,
    title: input.title.trim(),
    description: input.description.trim(),
    city: input.city?.trim() || null,
    state: input.state?.trim() || null,
    departureCountry: input.departureCountry.trim(),
    destinationCountry: input.destinationCountry.trim(),
    departureDate: input.departureDate?.trim() || null,
    sizeLimit: input.sizeLimit?.trim() || null,
    contactNote: input.contactNote?.trim() || null,
    carryTypes: input.carryTypes.filter(Boolean),
  };
}

export function validateReportReason(reason: string): reason is ListingReportReason {
  return [
    "spam",
    "fraud",
    "prohibited_item",
    "wrong_category",
    "duplicate",
    "offensive",
    "service_in_marketplace",
    "scam",
    "prohibited_service",
    "misleading_information",
    "unlicensed_claim",
    "inappropriate_content",
    "other",
  ].includes(reason);
}
