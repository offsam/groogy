"use client";

import { EntitySourceCard } from "@/components/shared/EntitySourceCard";
import { isPlatformOrigin } from "@/lib/business/presence";
import type { Church } from "@/types/church";

type ChurchSourceCardProps = {
  church: Church;
  isAuthenticated?: boolean;
  initiallyRevealed?: boolean;
};

export function ChurchSourceCard({
  church,
  isAuthenticated = false,
  initiallyRevealed = false,
}: ChurchSourceCardProps) {
  const platform = isPlatformOrigin(church);
  const hasSource =
    church.presenceFlags.hasSource ||
    platform ||
    Boolean(church.sourceUrl?.trim());

  if (!hasSource) return null;

  return (
    <EntitySourceCard
      anchorId="church-source"
      fetchPath={
        platform
          ? null
          : `/api/church/${encodeURIComponent(church.slug)}/source`
      }
      hasSource={hasSource}
      initiallyRevealed={
        initiallyRevealed || platform || Boolean(church.sourceUrl)
      }
      isAuthenticated={isAuthenticated || platform}
      sourceKind={church.sourceKind}
      sourceUrl={church.sourceUrl}
    />
  );
}
