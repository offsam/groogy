import type { Professional } from "@/types/professional";

/** Public badges for community recommendation vs self-ad counts. */
export function ProfessionalOriginBadges({
  professional,
  compact = false,
}: {
  professional: Professional;
  compact?: boolean;
}) {
  const third = professional.thirdPartyMentionCount;
  const self = professional.selfAdMentionCount;
  if (third == null && self == null) return null;
  const t = Math.max(0, Number(third ?? 0));
  const s = Math.max(0, Number(self ?? 0));
  if (t <= 0 && s <= 0) return null;

  const badgeClass = compact
    ? "rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
    : "rounded-lg px-2 py-1 text-xs font-semibold";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {t > 0 ? (
        <span
          className={`${badgeClass} bg-brand-green/15 text-emerald-800`}
          title="Сколько раз рекомендовали другие"
        >
          чужие ×{t}
        </span>
      ) : null}
      {s > 0 ? (
        <span
          className={`${badgeClass} bg-brand-orange/15 text-brand-orange`}
          title="Сколько раз рекламировали себя"
        >
          сами ×{s}
        </span>
      ) : null}
    </div>
  );
}
