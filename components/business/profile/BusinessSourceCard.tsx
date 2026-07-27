"use client";

import { EntitySourceCard } from "@/components/shared/EntitySourceCard";
import {
  hasProvenanceSource,
  isPlatformSource,
  resolveSourceUrl,
  type BusinessPresence,
} from "@/lib/business/presence";
import type { BusinessPresenceFlags } from "@/lib/business/presence-flags";

type BusinessSourceCardProps = {
  businessSlug: string;
  presence: BusinessPresence;
  presenceFlags?: BusinessPresenceFlags | null;
  isAuthenticated?: boolean;
  initiallyRevealed?: boolean;
  /** Owners / edit mode — show empty state if no source yet. */
  editMode?: boolean;
};

/** Provenance for business profile — below contacts, not inside them. */
export function BusinessSourceCard({
  businessSlug,
  presence,
  presenceFlags = null,
  isAuthenticated = false,
  initiallyRevealed = false,
  editMode = false,
}: BusinessSourceCardProps) {
  const sourceUrl = resolveSourceUrl(presence);
  const platform = isPlatformSource(presence.sourceKind);
  const hasSource =
    hasProvenanceSource(presence) ||
    Boolean(presenceFlags?.hasSource) ||
    platform;

  return (
    <EntitySourceCard
      anchorId="business-source"
      fetchPath={
        platform
          ? null
          : `/api/business/${encodeURIComponent(businessSlug)}/source`
      }
      hasSource={hasSource}
      initiallyRevealed={initiallyRevealed || editMode || platform}
      isAuthenticated={isAuthenticated || editMode || platform}
      showEmpty={editMode}
      sourceKind={presence.sourceKind}
      sourceUrl={sourceUrl}
    />
  );
}
