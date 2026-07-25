import Image from "next/image";
import Link from "next/link";
import { Star } from "lucide-react";
import { ClaimBusinessButton } from "@/components/business/ClaimBusinessButton";
import { hasRealBusinessPhoto } from "@/lib/business/media";
import type { Business } from "@/types/business";

type BusinessHeroProps = {
  business: Business;
  businessSlug: string;
  isOwner?: boolean;
  autoClaim?: boolean;
};

export function BusinessHero({
  business,
  businessSlug,
  isOwner = false,
  autoClaim = false,
}: BusinessHeroProps) {
  const hasPhoto = hasRealBusinessPhoto(business.imageUrl);

  const titleBlock = (
    <>
      {business.categoryName && (
        <p
          className={
            hasPhoto
              ? "text-xs font-medium uppercase tracking-wide text-slate-400"
              : "text-xs font-medium uppercase tracking-wide text-slate-300"
          }
        >
          {business.categoryName}
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{business.name}</h1>
        {business.reviewsCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-sm font-semibold text-amber-700">
            <Star aria-hidden="true" className="size-4 fill-amber-500 text-amber-500" />
            {business.ratingAvg.toFixed(1)}
            <span className="font-normal text-amber-600">
              ({business.reviewsCount})
            </span>
          </span>
        )}
      </div>
      {business.shortDescription && (
        <p className={hasPhoto ? "text-lg text-slate-600" : "text-lg text-slate-200"}>
          {business.shortDescription}
        </p>
      )}
      {isOwner ? (
        <Link
          className={
            hasPhoto
              ? "inline-flex rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50"
              : "inline-flex rounded-lg border border-white/30 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10"
          }
          href={`/business/${businessSlug}/manage`}
        >
          Управление
        </Link>
      ) : (
        <ClaimBusinessButton
          autoSubmit={autoClaim}
          businessId={business.id}
          businessSlug={businessSlug}
          checkStatus
          kind="business"
        />
      )}
    </>
  );

  if (!hasPhoto) {
    return (
      <header className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-800 via-slate-700 to-slate-900 text-white">
        <div className="space-y-3 p-6 sm:p-8">{titleBlock}</div>
      </header>
    );
  }

  return (
    <header className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="relative aspect-[2/1] max-h-80 w-full bg-slate-100">
        <Image
          alt={business.name}
          className="object-cover"
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 1024px"
          src={business.imageUrl!}
          unoptimized
        />
      </div>
      <div className="space-y-3 p-6 text-slate-900 sm:p-8">{titleBlock}</div>
    </header>
  );
}
