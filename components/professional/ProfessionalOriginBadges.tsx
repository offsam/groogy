import type { Professional } from "@/types/professional";
import {
  AdminOriginCountBadges,
  CommunityRecommendationBadge,
  CommunityRecommendationCount,
} from "@/components/shared/CommunityRecommendationCount";

/** Public: only third-party count (click → sources). Admin: чужие + сами. */
export function ProfessionalOriginBadges({
  professional,
  compact = false,
  mode = "public",
  sourceUrls = [],
}: {
  professional: Professional;
  compact?: boolean;
  mode?: "public" | "admin";
  sourceUrls?: string[];
}) {
  const third = professional.thirdPartyMentionCount;
  const self = professional.selfAdMentionCount;
  if (third == null && self == null && sourceUrls.length === 0) return null;
  const t = Math.max(0, Number(third ?? 0));
  const s = Math.max(0, Number(self ?? 0));
  if (t <= 0 && s <= 0 && sourceUrls.length === 0) return null;

  if (mode === "admin") {
    return (
      <AdminOriginCountBadges thirdParty={t} selfAd={s} compact={compact} />
    );
  }

  if (t <= 0 && sourceUrls.length === 0) return null;

  if (compact) {
    return (
      <CommunityRecommendationBadge
        compact
        count={Math.max(t, sourceUrls.length)}
      />
    );
  }

  return (
    <CommunityRecommendationCount
      count={Math.max(t, sourceUrls.length)}
      sourceUrls={sourceUrls}
    />
  );
}
