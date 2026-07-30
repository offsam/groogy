"use client";

import { EntitySourceCard } from "@/components/shared/EntitySourceCard";
import { isPlatformOrigin } from "@/lib/business/presence";
import type { Professional } from "@/types/professional";

type ProfessionalSourceCardProps = {
  professional: Professional;
  isAuthenticated?: boolean;
  initiallyRevealed?: boolean;
};

/** Provenance for professional profile — below contacts. */
export function ProfessionalSourceCard({
  professional,
  isAuthenticated = false,
  initiallyRevealed = false,
}: ProfessionalSourceCardProps) {
  const platform = isPlatformOrigin(professional);
  const hasSource =
    professional.presenceFlags.hasSource ||
    platform ||
    Boolean(professional.sourceUrl?.trim());

  if (!hasSource) return null;

  return (
    <EntitySourceCard
      anchorId="professional-source"
      fetchPath={
        platform
          ? null
          : `/api/professional/${encodeURIComponent(professional.slug)}/source`
      }
      hasSource={hasSource}
      initiallyRevealed={
        initiallyRevealed || platform || Boolean(professional.sourceUrl)
      }
      isAuthenticated={isAuthenticated || platform}
      sourceKind={professional.sourceKind}
      sourceUrl={professional.sourceUrl}
    />
  );
}
