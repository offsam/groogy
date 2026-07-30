/**
 * Home hub ↔ import_review entity_type / target_collection.
 * Used by Review Workspace type picker + live public-card preview.
 */

import {
  PLATFORM_SECTIONS,
  type PlatformSectionKey,
} from "@/lib/platform/sections";
import type {
  ImportReviewEntityType,
  ImportReviewTargetCollection,
} from "@/types/import-review";

export type HubImportTypes = {
  target_collection: ImportReviewTargetCollection;
  entity_type: ImportReviewEntityType;
};

export type ReviewHubOption = {
  key: PlatformSectionKey;
  title: string;
  hint: string;
  selectable: boolean;
  disabledReason?: string;
  types: HubImportTypes | null;
};

const HUB_IMPORT_TYPES: Partial<Record<PlatformSectionKey, HubImportTypes>> = {
  businesses: {
    target_collection: "businesses",
    entity_type: "business",
  },
  professionals: {
    target_collection: "private_specialists",
    entity_type: "private_specialist",
  },
  marketplace: {
    target_collection: "marketplace",
    entity_type: "marketplace_listing",
  },
  jobs: {
    target_collection: "jobs",
    entity_type: "job",
  },
  real_estate: {
    target_collection: "real_estate",
    entity_type: "real_estate",
  },
  events: {
    target_collection: "events",
    entity_type: "event",
  },
  lechu: {
    target_collection: "lechu",
    entity_type: "lechu_listing",
  },
  transfers: {
    target_collection: "transfers",
    entity_type: "transfer_listing",
  },
};

export const REVIEW_HUB_OPTIONS: ReviewHubOption[] = PLATFORM_SECTIONS.map(
  (section) => {
    const types = HUB_IMPORT_TYPES[section.key] ?? null;
    if (section.key === "vehicles") {
      return {
        key: section.key,
        title: section.title,
        hint: section.hint,
        selectable: false,
        disabledReason: "скоро — нет типа в очереди Review",
        types: null,
      };
    }
    if (!types) {
      return {
        key: section.key,
        title: section.title,
        hint: section.hint,
        selectable: false,
        disabledReason: "недоступно",
        types: null,
      };
    }
    return {
      key: section.key,
      title: section.title,
      hint: section.hint,
      selectable: true,
      types,
    };
  },
);

export function hubToImportTypes(
  key: PlatformSectionKey,
): HubImportTypes | null {
  return HUB_IMPORT_TYPES[key] ?? null;
}

export function importTypesToHub(
  collection: ImportReviewTargetCollection | string | null | undefined,
  entity: ImportReviewEntityType | string | null | undefined,
): PlatformSectionKey | null {
  const target = (collection || "").trim();
  const et = (entity || "").trim();

  if (target === "lechu" || et === "lechu_listing") return "lechu";
  if (target === "transfers" || et === "transfer_listing") return "transfers";
  if (target === "marketplace" || et === "marketplace_listing") {
    return "marketplace";
  }
  if (target === "real_estate" || et === "real_estate") return "real_estate";
  if (target === "jobs" || et === "job") return "jobs";
  if (target === "events" || et === "event") return "events";
  if (target === "private_specialists" || et === "private_specialist") {
    return "professionals";
  }
  if (target === "services") return "professionals";
  if (
    target === "businesses" ||
    target === "organizations" ||
    et === "business" ||
    et === "organization"
  ) {
    return "businesses";
  }
  return null;
}

export function hubSectionTitle(key: PlatformSectionKey | null): string {
  if (!key) return "не выбран";
  return PLATFORM_SECTIONS.find((s) => s.key === key)?.title ?? key;
}

export function hubPreviewLabel(key: PlatformSectionKey | null): string {
  return `Будет в разделе: ${hubSectionTitle(key)}`;
}
