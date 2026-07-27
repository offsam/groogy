import type {
  ImportReviewEntityType,
  ImportReviewTargetCollection,
} from "@/types/import-review";
import type { PlatformSectionKey } from "@/lib/platform/sections";

/** How the admin preview card should render. */
export type ImportPreviewKind =
  | "business"
  | "professional"
  | "marketplace"
  | "real_estate"
  | "services"
  | "lechu"
  | "transfers"
  | "jobs"
  | "events";

export const IMPORT_PREVIEW_KIND_LABELS: Record<ImportPreviewKind, string> = {
  business: "Бизнес",
  professional: "Профи",
  marketplace: "Marketplace",
  real_estate: "Недвижимость",
  services: "Услуги",
  lechu: "Лечу",
  transfers: "Переводы",
  jobs: "Вакансии",
  events: "События",
};

export const IMPORT_PREVIEW_KIND_HINTS: Record<ImportPreviewKind, string> = {
  business: "карточка в каталоге бизнесов",
  professional: "карточка специалиста",
  marketplace: "объявление на Marketplace",
  real_estate: "объявление о недвижимости",
  services: "карточка услуги / мастера",
  lechu: "маршрут «Лечу»",
  transfers: "предложение перевода",
  jobs: "вакансия",
  events: "событие",
};

/** Map queue classification → public preview surface. */
export function resolveImportPreviewKind(input: {
  target_collection?: ImportReviewTargetCollection | string | null;
  entity_type?: ImportReviewEntityType | string | null;
}): ImportPreviewKind {
  const target = (input.target_collection || "").trim();
  const entity = (input.entity_type || "").trim();

  if (target === "lechu" || entity === "lechu_listing") {
    return "lechu";
  }
  if (target === "transfers" || entity === "transfer_listing") {
    return "transfers";
  }
  if (target === "marketplace" || entity === "marketplace_listing") {
    return "marketplace";
  }
  if (target === "real_estate" || entity === "real_estate") {
    return "real_estate";
  }
  if (target === "services") {
    return "services";
  }
  if (target === "private_specialists" || entity === "private_specialist") {
    return "professional";
  }
  if (target === "jobs" || entity === "job") {
    return "jobs";
  }
  if (target === "events" || entity === "event") {
    return "events";
  }
  if (target === "organizations" || entity === "organization") {
    return "business";
  }
  if (target === "businesses" || entity === "business") {
    return "business";
  }

  // Heuristic fallback from entity alone
  if (entity === "private_specialist") return "professional";

  return "business";
}

export function previewKindToPlatformSection(
  kind: ImportPreviewKind,
): PlatformSectionKey | null {
  switch (kind) {
    case "business":
      return "businesses";
    case "marketplace":
      return "marketplace";
    case "real_estate":
      return "marketplace";
    case "services":
      return "professionals";
    case "professional":
      return "professionals";
    case "lechu":
      return "lechu";
    case "transfers":
      return "transfers";
    default:
      return null;
  }
}
