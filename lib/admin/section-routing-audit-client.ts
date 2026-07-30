/** Client-safe helpers for wrong-section UI (no server-only imports). */

import type { MoveSectionKey } from "@/lib/admin/move-entity-section";

const SUGGESTED_TO_SECTION: Record<string, MoveSectionKey> = {
  private_specialist: "professionals",
  business: "businesses",
  marketplace_listing: "marketplace",
  job: "jobs",
  event: "events",
  lechu_listing: "lechu",
  transfer_listing: "transfers",
  organization: "businesses",
};

export function suggestedSectionForType(
  entityType: string,
): MoveSectionKey | null {
  return SUGGESTED_TO_SECTION[entityType] ?? null;
}
