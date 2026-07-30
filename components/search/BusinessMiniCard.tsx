import Link from "next/link";
import type { Business } from "@/types/business";
import { CommunityRecommendationBadge } from "@/components/shared/CommunityRecommendationCount";

type Props = {
  business: Business;
};

/** Compact popular preview — not a full BusinessCard. */
export function BusinessMiniCard({ business }: Props) {
  const photo = business.imageUrl;
  const recCount = Math.max(0, Number(business.thirdPartyMentionCount ?? 0));

  return (
    <Link
      href={`/business/${business.slug}`}
      className="business-mini-card group flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_2px_12px_rgba(15,23,42,0.06)] transition hover:border-brand-blue/25 hover:shadow-[0_6px_20px_rgba(15,23,42,0.1)]"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-slate-100">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt=""
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] font-medium text-slate-400">
            КРУГИ
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2.5">
        <p className="line-clamp-2 text-[14px] font-semibold leading-snug text-slate-900">
          {business.name}
        </p>
        {business.city ? (
          <p className="truncate text-[11px] text-slate-400">{business.city}</p>
        ) : null}
        {recCount > 0 ? (
          <div className="mt-1">
            <CommunityRecommendationBadge compact count={recCount} />
          </div>
        ) : null}
      </div>
    </Link>
  );
}
