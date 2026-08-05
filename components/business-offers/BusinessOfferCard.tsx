import { ServiceListRow } from "@/components/shared/ServiceListRow";
import type { BusinessPresence } from "@/lib/business/presence";
import type { BusinessOffer } from "@/types/business-offer";
import { formatOfferPrice } from "@/lib/business-offers/mappers";

type BusinessOfferCardProps = {
  offer: BusinessOffer;
  businessSlug: string;
  presence?: BusinessPresence | null;
  /** Parent business already has a confirmed owner — nested claim hidden. */
  businessAlreadyClaimed?: boolean;
};

export function BusinessOfferCard({
  offer,
  businessSlug,
}: BusinessOfferCardProps) {
  const price = formatOfferPrice(offer);
  const href = `/business/${businessSlug}/offers/${offer.slug}`;

  return (
    <ServiceListRow
      href={href}
      price={price}
      subtitle={!offer.isAvailable ? "Недоступно" : null}
      title={offer.title}
    />
  );
}
