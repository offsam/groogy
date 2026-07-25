import Image from "next/image";
import Link from "next/link";
import { BusinessPresenceBadges } from "@/components/business/BusinessPresenceBadges";
import { ClaimBusinessButton } from "@/components/business/ClaimBusinessButton";
import type { BusinessPresence } from "@/lib/business/presence";
import type { BusinessOffer } from "@/types/business-offer";
import { formatOfferPrice, offerCoverUrl } from "@/lib/business-offers/mappers";

type BusinessOfferCardProps = {
  offer: BusinessOffer;
  businessSlug: string;
  presence?: BusinessPresence | null;
};

export function BusinessOfferCard({
  offer,
  businessSlug,
  presence = null,
}: BusinessOfferCardProps) {
  const cover = offerCoverUrl(offer);
  const price = formatOfferPrice(offer);
  const href = `/business/${businessSlug}/offers/${offer.slug}`;

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition-shadow hover:shadow-md">
      <Link className="block" href={href}>
        <div className="relative aspect-[4/3] bg-slate-100">
          {cover ? (
            <Image
              alt={offer.title}
              className="object-cover"
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              src={cover}
              unoptimized
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              Нет фото
            </div>
          )}
          {!offer.isAvailable && (
            <span className="absolute left-3 top-3 rounded-md bg-slate-900/80 px-2 py-1 text-xs font-medium text-white">
              Недоступно
            </span>
          )}
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {offer.categoryName && (
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {offer.categoryName}
          </p>
        )}
        <Link className="block" href={href}>
          <h3 className="line-clamp-2 text-base font-semibold text-slate-900">
            {offer.title}
          </h3>
        </Link>
        {presence ? <BusinessPresenceBadges className="mt-0" presence={presence} /> : null}
        {offer.shortDescription && (
          <p className="line-clamp-2 text-sm text-slate-600">{offer.shortDescription}</p>
        )}
        <p className="mt-auto text-lg font-semibold text-slate-900">{price}</p>

        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            className="inline-flex flex-1 items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            href={href}
          >
            Просмотр
          </Link>
          {businessSlug ? (
            <ClaimBusinessButton
              businessId={offer.businessId}
              businessSlug={businessSlug}
              kind="offer"
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}
