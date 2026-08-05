/**
 * Canonical P3 entity section router — TS mirror of
 * scripts/import-review/entity_routing.py (SoT lives there).
 *
 * Used for admin hints only — does not write to the DB.
 * Preview fallback to "business" in resolveImportPreviewKind stays UI-only.
 *
 * Import / our curation rule (map businesses):
 *  - No precise street address → private_specialist (never businesses).
 *  - Brand / «business name» alone is NOT proof of a map business.
 *  - Street address alone does NOT force businesses either.
 *
 * Keep in sync with the Python module.
 */

import type {
  ImportReviewEntityType,
  ImportReviewTargetCollection,
} from "@/types/import-review";
import { TAG_NEEDS_MANUAL_TYPE } from "@/lib/import-review/review-tags";

export const ENTITY_TO_COLLECTION: Record<
  ImportReviewEntityType,
  ImportReviewTargetCollection
> = {
  business: "businesses",
  organization: "organizations",
  private_specialist: "private_specialists",
  marketplace_listing: "marketplace",
  job: "jobs",
  real_estate: "real_estate",
  event: "events",
  lechu_listing: "lechu",
  transfer_listing: "transfers",
};

export const VALID_PAIRS: ReadonlyArray<
  readonly [ImportReviewEntityType, ImportReviewTargetCollection]
> = [
  ["business", "businesses"],
  ["business", "services"],
  ["business", "organizations"],
  ["organization", "organizations"],
  ["organization", "businesses"],
  ["private_specialist", "private_specialists"],
  ["marketplace_listing", "marketplace"],
  ["job", "jobs"],
  ["real_estate", "real_estate"],
  ["event", "events"],
  ["lechu_listing", "lechu"],
  ["transfer_listing", "transfers"],
];

const REAL_ESTATE_CATEGORIES = new Set([
  "real_estate_services",
  "realtor",
  "mortgage",
  "property_management",
]);

const LECHU_RE =
  /(?:^|\n|#)\s*лечу\b|#лечу\b|летим\b|летит\b|возьму\s+(?:посыл|документ|чемодан|вещи)|заберу\s+и\s+привезу|передам\s+(?:посыл|документ)|flying\s+to|take\s+packages?\b/i;
const TRANSFER_RE =
  /(?:денежн\w*\s+)?перевод(?:ы|ов)?\s+(?:в|из|на)\s+(?:росси|сша|украин|европ|карт)|money\s+transfer|wire\s+transfer|remittance|swift\b|крипто\s*(?:в|→|->|to)\s*фиат|фиат\s*(?:в|→|->|to)\s*крипто|обмен\s+валют|меняю\s+(?:руб|доллар|\$)|куплю\s+руб|продам\s+руб|куплю\s+доллар|продам\s+доллар|рубл\w*\s+на\s+(?:карт|доллар)|доллар\w*\s+на\s+руб|переведу\s+(?:деньги|доллар|руб)|оплачу\s+(?:вашу|ваш[уые]?).{0,40}рубл|комисси[яи]\s*\d+\s*%\s*(?:за\s+)?перевод/i;
const TRANSLATOR_NOISE_RE =
  /переводчик|certified\s+translation|апостил|document\s+preparation|преподаватель|язык(?:а|ов)?\b/i;
const JOB_HIRE_RE =
  /(требуется|ищем\s+(?:сотрудника|работника|provider|owner-?operator)|вакансия|hiring|на\s+чек|приглашает\s+owner)/i;
const REAL_ESTATE_OFFER_RE =
  /(сда[её]тся|сдаю|сдаем)\s+.{0,40}(комнат|квартир|дом|студи|bedroom|condo|house)|(комната|квартира|студия).{0,40}(сда[её]тся|\$\s?\d|\/мес)/i;
const EVENT_RE =
  /(мероприят|концерт|встреча|пикник|speed\s+dating|singles|анонсов|вечеринка|вылазк)/i;
const BUSINESS_SIGNAL_RE =
  /\b(inc|llc|corp|company|компани[яи]|студия|салон|агентство|insurance|страхован)\b/i;

/**
 * Retail storefront / shop brand in the copy. Outranks a Telegram person-name
 * slot the same way cargo ops do — «Maksim Degtyar» posting for a flower
 * boutique is still a shop card, not a private specialist.
 */
export const RETAIL_STOREFRONT_RE =
  /flower\s+boutique|flower\s+shop|\bflorist\b|\bboutique\b|цветочн\p{L}*|магазин\s+цвет|бутик\s+цвет|\b(?:gift|wine|jewelry|jewellery)\s+shop\b|\b(?:grocery|gourmet)\s+(?:store|market|shop)\b/iu;

/**
 * Copy only an operating company writes: pickup points, tariff tables, courier
 * services, cargo / logistics wording. Strong enough to outrank a person-name
 * slot, which importers fill with the poster's own name.
 */
const COMPANY_OPERATIONS_RE =
  /\b(?:карго|cargo|freight)\b|грузоперевоз|логистическ|logistics|пункт\p{L}*\s+(?:приёма|приема|выдачи|самовывоза)|тариф\p{L}*\s+и\s+сроки|курьерск\p{L}*\s+служб|отправляем\s+(?:в|по)\s|доставка\s+из\s+сша|доставляем\s+(?:по|в)\s/iu;
const SPECIALIST_SIGNAL_RE =
  /(барбер|стрижк|психолог|репетитор|преподаватель|мастер|консультирован|няня|тренер|фотограф|лицензированн)/i;
const PERSONAL_GOODS_RE =
  /\b(прода[юе]м\s+(?:личн|свою|детск)|отда[мю]\s+даром|garage\s+sale)\w*/i;
const GOODS_SALE_VERB_RE =
  /\b(прода[юёе]т?|продам|продаём|продаем|for\s+sale|selling)\b/i;
const GOODS_PRODUCT_RE =
  /(?:пияв|принтер|коляск|мебел|телефон\s+прода|high\s+chair|chicco|pixma|гаражн)/i;
const GOODS_FULFILLMENT_RE =
  /(?:доставк|отправ(?:лю|ка|им)|по\s+сша|shipping|самовывоз|цена\s+за\s+(?:штук|ед|упаков)|в\s+наличии|\$\s*\d+|usd\s*\d+)/i;
const SERVICE_VERB_RE =
  /(?:записыва|принимаю\s+(?:на|к)|сеанс|консультац|массаж|маникюр|педикюр|стрижк|окрашив|работаю\s+(?:как|по)|услуги|предоставляю|провожу)/i;

const STREET_SUFFIX_RE =
  /\b(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|ct|court|hwy|highway|pkwy|parkway|pl|place|cir|circle|ter|terrace|улиц\w*|проспект|бульвар|переулок|шоссе|набережн\w*)\b/i;
const SERVICE_AREA_RE =
  /окрестн|nearby|and\s+around|service\s+area|выезд\s+по|и\s+район/i;

/** Scraper / CMS garbage that must never count as a street pin (additive R03). */
const GARBAGE_STREET_RE =
  /wp-theme|wp-child|single-format|woocommerce|elementor|class=["']|<\/?[a-z]{1,12}\b/i;

/**
 * True when address_line is HTML/CSS/theme junk, not a human street.
 * Additive guard — does not change valid streets.
 */
export function isGarbageStreetLine(
  addressLine: string | null | undefined,
): boolean {
  const line = (addressLine || "").trim();
  if (!line) return false;
  if (GARBAGE_STREET_RE.test(line)) return true;
  const words = line.split(/\s+/);
  if (
    words.length >= 6 &&
    !STREET_SUFFIX_RE.test(line) &&
    !/^\d{1,6}\s+\S/.test(line)
  ) {
    const weird = words.filter((w) => /[-_]/.test(w) || /^wp-/i.test(w)).length;
    if (weird >= 3) return true;
  }
  return false;
}

const DATE_SIGNAL_RE =
  /(?:\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)|(?:\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|январ\w*|феврал\w*|март\w*|апрел\w*|ма[йя]\w*|июн\w*|июл\w*|август\w*|сентябр\w*|октябр\w*|ноябр\w*|декабр\w*)\w*)|starts_at/i;

export function hasDateSignal(text: string | null | undefined): boolean {
  return DATE_SIGNAL_RE.test(text || "");
}

export type RouteResult = {
  entityType: ImportReviewEntityType | null;
  targetCollection: ImportReviewTargetCollection | null;
  confidence: "high" | "medium" | "none";
  reason: string;
  needsManualType: boolean;
};

/** True only for a concrete street pin — not city / service-area blurbs. */
export function hasStreetAddress(input: {
  addressLine?: string | null;
  postalCode?: string | null;
  locationPrecision?: string | null;
}): boolean {
  if ((input.locationPrecision || "").trim().toLowerCase() === "street") {
    if (isGarbageStreetLine(input.addressLine)) return false;
    return true;
  }
  const line = (input.addressLine || "").trim();
  if (!line || line.length < 5) return false;
  if (isGarbageStreetLine(line)) return false;
  if (SERVICE_AREA_RE.test(line) && !/\d/.test(line)) return false;
  if (/^\d{1,6}\s+\S/.test(line)) return true;
  if (/\d/.test(line) && STREET_SUFFIX_RE.test(line)) return true;
  if (/\d{1,6}\s+[A-Za-zА-Яа-яЁё]/.test(line) && line.length >= 10) return true;
  return false;
}

export function isValidPair(
  entityType: string | null | undefined,
  targetCollection: string | null | undefined,
): boolean {
  if (!entityType || !targetCollection) return false;
  return VALID_PAIRS.some(
    ([t, c]) => t === entityType && c === targetCollection,
  );
}

export function detectGoodsSale(text: string): boolean {
  const blob = text || "";
  if (PERSONAL_GOODS_RE.test(blob)) return true;
  const product = GOODS_PRODUCT_RE.test(blob);
  const fulfill = GOODS_FULFILLMENT_RE.test(blob);
  const saleVerb = GOODS_SALE_VERB_RE.test(blob);
  const service = SERVICE_VERB_RE.test(blob);
  const specialist = SPECIALIST_SIGNAL_RE.test(blob);
  if (product && fulfill && !service) return true;
  if (saleVerb && (product || fulfill) && !service) return true;
  if (saleVerb && !service && !specialist) return true;
  return false;
}

function hit(
  entityType: ImportReviewEntityType,
  confidence: "high" | "medium",
  reason: string,
): RouteResult {
  return {
    entityType,
    targetCollection: ENTITY_TO_COLLECTION[entityType],
    confidence,
    reason,
    needsManualType: false,
  };
}

function manual(reason: string): RouteResult {
  return {
    entityType: null,
    targetCollection: null,
    confidence: "none",
    reason,
    needsManualType: true,
  };
}

function businessOrSpecialistForImport(
  hasStreet: boolean,
  confidence: "high" | "medium",
  reason: string,
): RouteResult {
  if (hasStreet) return hit("business", confidence, reason);
  return hit(
    "private_specialist",
    confidence,
    `${reason}+no_street→specialist`,
  );
}

export function routeCard(input: {
  text?: string | null;
  category?: string | null;
  businessName?: string | null;
  personName?: string | null;
  classification?: string | null;
  entityTypeHint?: string | null;
  hasContact?: boolean;
  addressLine?: string | null;
  postalCode?: string | null;
  locationPrecision?: string | null;
  hasStreet?: boolean | null;
}): RouteResult {
  const cat = (input.category || "").trim();
  const bn = (input.businessName || "").trim();
  const pn = (input.personName || "").trim();
  const blob = input.text || "";
  const classification = (input.classification || "").trim() || null;
  const hint = (input.entityTypeHint || "").trim() || null;
  const hasContact = Boolean(input.hasContact);
  const street =
    input.hasStreet != null
      ? Boolean(input.hasStreet)
      : hasStreetAddress({
          addressLine: input.addressLine,
          postalCode: input.postalCode,
          locationPrecision: input.locationPrecision,
        });

  // Sphere «Организация праздников» uses slug celebrations — not dated affiche.
  // Legacy category=events maps to affiche only when the copy carries a date.
  if (cat === "celebrations" || cat === "party_planning") {
    return businessOrSpecialistForImport(
      street,
      "high",
      `gate0:category=${cat}`,
    );
  }
  if (cat === "events") {
    if (hasDateSignal(blob)) {
      return hit("event", "high", "gate0:category=events+date");
    }
    return businessOrSpecialistForImport(
      street,
      "medium",
      "gate0:category=events+no_date→business_or_specialist",
    );
  }
  if (REAL_ESTATE_CATEGORIES.has(cat)) {
    return hit("real_estate", "high", `gate0:category=${cat}`);
  }
  if (REAL_ESTATE_OFFER_RE.test(blob)) {
    return hit("real_estate", "high", "gate0:real_estate_offer_re");
  }

  if (LECHU_RE.test(blob)) return hit("lechu_listing", "high", "gate1:lechu_re");
  if (TRANSFER_RE.test(blob) && !TRANSLATOR_NOISE_RE.test(blob)) {
    return hit("transfer_listing", "high", "gate1:transfer_re");
  }
  if (JOB_HIRE_RE.test(blob)) return hit("job", "medium", "gate1:job_hire_re");
  if (detectGoodsSale(blob)) {
    return hit("marketplace_listing", "medium", "gate1:goods_sale");
  }
  if (PERSONAL_GOODS_RE.test(blob) && !bn) {
    return hit("marketplace_listing", "medium", "gate1:personal_goods_re");
  }

  if (classification === "marketplace_item" || hint === "marketplace_listing") {
    return hit("marketplace_listing", "high", "gate1b:classification=marketplace");
  }
  if (classification === "real_estate_listing" || hint === "real_estate") {
    return hit("real_estate", "high", "gate1b:classification=real_estate");
  }
  if (classification === "job_post" || hint === "job") {
    return hit("job", "high", "gate1b:classification=job");
  }
  if (classification === "event_ad" || hint === "event") {
    return hit("event", "high", "gate1b:classification=event");
  }
  if (classification === "direct_business_ad" || hint === "business") {
    return businessOrSpecialistForImport(
      street,
      hasContact ? "high" : "medium",
      "gate1b:classification=business",
    );
  }
  if (
    classification === "direct_specialist_ad" ||
    classification === "self_promotion_without_contact" ||
    hint === "private_specialist"
  ) {
    if (detectGoodsSale(blob)) {
      return hit("marketplace_listing", "medium", "gate1b:override_specialist_goods");
    }
    return hit("private_specialist", "high", "gate1b:classification=specialist");
  }
  if (hint === "organization") {
    if (street) return hit("organization", "high", "gate1b:hint=organization");
    return hit(
      "private_specialist",
      "high",
      "gate1b:hint=organization+no_street→specialist",
    );
  }
  if (hint && hint in ENTITY_TO_COLLECTION) {
    if (hint === "business") {
      return businessOrSpecialistForImport(
        street,
        "medium",
        `gate1b:hint=${hint}`,
      );
    }
    return hit(
      hint as ImportReviewEntityType,
      "medium",
      `gate1b:hint=${hint}`,
    );
  }

  if (
    EVENT_RE.test(blob) &&
    (hasContact || /(присоединя|записыва|билет|\$)/i.test(blob))
  ) {
    return hit("event", "medium", "gate1c:event_re");
  }

  if (COMPANY_OPERATIONS_RE.test(blob) && !SPECIALIST_SIGNAL_RE.test(blob)) {
    return businessOrSpecialistForImport(
      street,
      hasContact || bn ? "high" : "medium",
      "gate2:company_operations_re",
    );
  }
  if (RETAIL_STOREFRONT_RE.test(blob) && !SPECIALIST_SIGNAL_RE.test(blob)) {
    return businessOrSpecialistForImport(
      street,
      hasContact || bn ? "high" : "medium",
      "gate2:retail_storefront_re",
    );
  }
  // Brand / trade name alone is NOT a map business — pros use brands too.
  if (bn && !pn) {
    return hit(
      "private_specialist",
      hasContact ? "high" : "medium",
      "gate2:brand_name_default_specialist",
    );
  }
  if (pn && !bn) {
    return hit(
      "private_specialist",
      hasContact ? "high" : "medium",
      "gate2:person_name_slot",
    );
  }
  if (BUSINESS_SIGNAL_RE.test(blob) && !SPECIALIST_SIGNAL_RE.test(blob)) {
    return businessOrSpecialistForImport(
      street,
      hasContact ? "high" : "medium",
      "gate2:business_signal_re",
    );
  }
  if (SPECIALIST_SIGNAL_RE.test(blob) && !BUSINESS_SIGNAL_RE.test(blob)) {
    return hit(
      "private_specialist",
      hasContact ? "high" : "medium",
      "gate2:specialist_signal_re",
    );
  }

  return manual("gate3:no_signal");
}

export function routeHintLabel(result: RouteResult): string | null {
  if (!result.entityType || !result.targetCollection) {
    return result.needsManualType
      ? `Нужна ручная классификация (${TAG_NEEDS_MANUAL_TYPE})`
      : null;
  }
  const titles: Record<string, string> = {
    businesses: "Бизнесы",
    private_specialists: "Специалисты",
    marketplace: "Купи-продай",
    jobs: "Работа",
    events: "События",
    lechu: "Лечу",
    transfers: "Переводы",
    real_estate: "Недвижимость",
    organizations: "Организации",
    services: "Услуги",
  };
  return `${titles[result.targetCollection] ?? result.targetCollection} · ${result.reason}`;
}
