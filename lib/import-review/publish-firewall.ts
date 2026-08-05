/**
 * R17 — Hard publish firewall (deterministic).
 * Additive only: does not remove existing approve/enrich/merge paths.
 * LLM / enrich may SUGGEST; this module DECIDES on approve + autopublish.
 */

import {
  hasStreetAddress,
  isGarbageStreetLine,
  routeCard,
  type RouteResult,
} from "@/lib/import-review/entity-routing";
import { mapBizCategorySlugToPro } from "@/lib/import-review/category-slug-map";
import type { ImportReviewTargetCollection } from "@/types/import-review";

export type PublishFirewallInput = {
  targetCollection: ImportReviewTargetCollection | string | null | undefined;
  categorySlug?: string | null;
  text?: string | null;
  personName?: string | null;
  businessName?: string | null;
  addressLine?: string | null;
  postalCode?: string | null;
  locationPrecision?: string | null;
};

export type PublishFirewallResult =
  | { ok: true; route: RouteResult; categorySlug?: string | null }
  | {
      ok: false;
      code: string;
      message: string;
      rewrite?: {
        targetCollection: ImportReviewTargetCollection;
        categorySlug?: string | null;
      };
    };

const LEGAL_CAT = new Set(["legal", "immigration", "notary"]);
const REPAIR_SIGNAL =
  /сантехник|электрик|хендимен|handyman|ремонт\s*(квартир|дом|ванн)|home\s*repair|клининг|уборк|cleaning|строител|подряд/i;
const LEGAL_SIGNAL =
  /юрист|адвокат|нотариус|\blawyer\b|\battorney\b|паралегал|иммиграцион/i;

/** Strong hiring / CDL ads misfiled as pro/business (Sonnet P-finding). */
const STRONG_JOB_RE =
  /(?:\bcdl\b.{0,20}\$?\s*\d|локальн\w*\s+работ|вакансия|требуется\s+(?:водитель|сотрудник)|hiring\s+(?:cdl|driver)|\$\s*\d+\s*\/\s*h\b|ищем\s+водитель)/i;

const COLLECTION_ENTITY: Record<string, string> = {
  businesses: "business",
  organizations: "organization",
  services: "business",
  private_specialists: "private_specialist",
  marketplace: "marketplace_listing",
  jobs: "job",
  real_estate: "real_estate",
  events: "event",
  lechu: "lechu_listing",
  transfers: "transfer_listing",
};

function textBlob(input: PublishFirewallInput): string {
  return [input.text, input.personName, input.businessName, input.categorySlug]
    .filter(Boolean)
    .join("\n");
}

function rewriteForEntity(
  routedEntity: string,
): ImportReviewTargetCollection | null {
  if (routedEntity === "private_specialist") return "private_specialists";
  if (routedEntity === "business") return "businesses";
  if (routedEntity === "transfer_listing") return "transfers";
  if (routedEntity === "lechu_listing") return "lechu";
  if (routedEntity === "marketplace_listing") return "marketplace";
  if (routedEntity === "job") return "jobs";
  if (routedEntity === "event") return "events";
  if (routedEntity === "real_estate") return "real_estate";
  return null;
}

/**
 * Block publish when target section/category contradicts hard routing signals.
 */
export function assertPublishAllowed(
  input: PublishFirewallInput,
): PublishFirewallResult {
  const collection = String(input.targetCollection || "").trim();
  if (!collection) {
    return {
      ok: false,
      code: "missing_collection",
      message: "Укажите раздел (target_collection).",
    };
  }

  const blob = textBlob(input);

  // Additive: strong job ads cannot publish as pro/business.
  if (
    (collection === "private_specialists" ||
      collection === "businesses" ||
      collection === "organizations" ||
      collection === "services") &&
    STRONG_JOB_RE.test(blob)
  ) {
    return {
      ok: false,
      code: "section_jobs",
      message:
        "Похоже на вакансию / набор сотрудников — публикуйте в разделе «Работа», не как специалиста или бизнес.",
      rewrite: { targetCollection: "jobs" },
    };
  }

  // Additive: CMS/HTML junk is not a street.
  if (
    (collection === "businesses" ||
      collection === "organizations" ||
      collection === "services") &&
    isGarbageStreetLine(input.addressLine)
  ) {
    return {
      ok: false,
      code: "garbage_street",
      message:
        "В адресе HTML/мусор с сайта, не улица. Исправьте адрес или опубликуйте как специалиста.",
      rewrite: { targetCollection: "private_specialists" },
    };
  }

  const route = routeCard({
    text: blob,
    personName: input.personName,
    businessName: input.businessName,
    category: input.categorySlug,
    hasContact: true,
    addressLine: input.addressLine,
    postalCode: input.postalCode,
    locationPrecision: input.locationPrecision,
  });

  const expectedEntity = COLLECTION_ENTITY[collection];
  const routedEntity = route.entityType;

  if (
    route.confidence === "high" &&
    routedEntity &&
    expectedEntity &&
    routedEntity !== expectedEntity
  ) {
    const rewriteCollection = rewriteForEntity(routedEntity);
    return {
      ok: false,
      code: "section_mismatch",
      message: `Раздел «${collection}» не подходит тексту (${route.reason}). Нужен другой раздел.`,
      rewrite: rewriteCollection
        ? { targetCollection: rewriteCollection }
        : undefined,
    };
  }

  if (
    collection === "businesses" ||
    collection === "organizations" ||
    collection === "services"
  ) {
    const hasStreet = hasStreetAddress({
      addressLine: input.addressLine,
      postalCode: input.postalCode,
      locationPrecision: input.locationPrecision,
    });
    if (!hasStreet) {
      return {
        ok: false,
        code: "business_needs_street",
        message:
          "Без улицы нельзя в «Бизнесы» — опубликуйте как специалиста или добавьте адрес.",
        rewrite: { targetCollection: "private_specialists" },
      };
    }
  }

  let cat = String(input.categorySlug || "").trim();
  if (collection === "private_specialists") {
    const remapped = mapBizCategorySlugToPro(cat);
    if (remapped) cat = remapped;

    if (!cat || cat === "pro_other") {
      return {
        ok: false,
        code: "pro_other_banned",
        message:
          "Выберите реальную категорию специалиста (не «Прочее») перед публикацией.",
      };
    }
    if (
      LEGAL_CAT.has(cat) &&
      REPAIR_SIGNAL.test(blob) &&
      !LEGAL_SIGNAL.test(blob)
    ) {
      const nameBlob = `${input.personName || ""} ${input.businessName || ""}`;
      if (!/lawyer|attorney|юрист|адвокат|нотариус/i.test(nameBlob)) {
        return {
          ok: false,
          code: "category_mismatch_repair_vs_legal",
          message:
            "Текст про ремонт/дом — нельзя в категорию юристов. Выберите «Дом и ремонт» / home_services.",
          rewrite: {
            targetCollection: "private_specialists",
            categorySlug: "home_services",
          },
        };
      }
    }
  }

  return { ok: true, route, categorySlug: cat || input.categorySlug };
}
