import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { RevealContacts } from "@/components/business/RevealContacts";
import { ClaimBusinessButton } from "@/components/business/ClaimBusinessButton";
import { BusinessOfferCard } from "@/components/business-offers/BusinessOfferCard";
import { OfferAttributesList } from "@/components/business-offers/OfferAttributesList";
import { formatOfferPrice, offerCoverUrl } from "@/lib/business-offers/mappers";
import {
  getPublicOfferBySlug,
  getSimilarOffers,
} from "@/lib/business-offers/queries";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getBusinessBySlug } from "@/lib/supabase/queries";
import { formatAddress, stripBusinessContacts } from "@/lib/supabase/mappers";
import { businessHasOwner } from "@/lib/reviews/queries";
import { OFFER_TYPE_SINGULAR } from "@/types/business-offer";

type OfferPageProps = {
  params: Promise<{ slug: string; offerSlug: string }>;
};

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://example.com";

export async function generateMetadata({
  params,
}: OfferPageProps): Promise<Metadata> {
  const { slug, offerSlug } = await params;
  const client = await createServerClient();
  const offer = await getPublicOfferBySlug(client, slug, offerSlug);
  if (!offer) return { title: "Предложение не найдено", robots: { index: false } };

  const description =
    offer.shortDescription ??
    offer.description?.slice(0, 160) ??
    `${offer.title} — ${offer.businessName ?? slug}`;

  return {
    title: `${offer.title} — ${offer.businessName ?? slug}`,
    description,
    alternates: {
      canonical: `${SITE_URL}/business/${slug}/offers/${offerSlug}`,
    },
    openGraph: {
      title: offer.title,
      description,
      url: `${SITE_URL}/business/${slug}/offers/${offerSlug}`,
      images: offerCoverUrl(offer) ? [{ url: offerCoverUrl(offer)! }] : undefined,
    },
  };
}

export default async function OfferDetailPage({ params }: OfferPageProps) {
  const { slug, offerSlug } = await params;
  const client = await createServerClient();
  const catalog = createServiceRoleClient();

  const [fullBusiness, offer] = await Promise.all([
    getBusinessBySlug(catalog, slug),
    getPublicOfferBySlug(client, slug, offerSlug),
  ]);

  if (!fullBusiness || !offer) notFound();

  const alreadyClaimed = await businessHasOwner(client, fullBusiness.id).catch(
    () => false,
  );
  const business = stripBusinessContacts(fullBusiness);
  const similar = await getSimilarOffers(client, offer);
  const price = formatOfferPrice(offer);
  const address = formatAddress(business);
  const addressWithRegion =
    address && business.region ? `${address}, ${business.region}` : address;
  const images =
    offer.media && offer.media.length > 0
      ? offer.media
      : offer.primaryImageUrl
        ? [{ publicUrl: offer.primaryImageUrl, altText: offer.title }]
        : [];

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-12">
      <Link
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
        href={`/business/${slug}`}
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {business.name}
      </Link>

      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {OFFER_TYPE_SINGULAR[offer.offerType]}
          {!offer.isAvailable && " · Недоступно"}
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          {offer.title}
        </h1>
        <p className="text-2xl font-semibold text-slate-900">{price}</p>
        <ClaimBusinessButton
          businessAlreadyClaimed={alreadyClaimed}
          businessId={business.id}
          businessSlug={slug}
          checkStatus
          kind="offer"
        />
      </header>

      {images.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {images.map((img, i) => (
            <div
              key={i}
              className="relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-100"
            >
              {img.publicUrl && (
                <Image
                  alt={img.altText ?? offer.title}
                  className="object-cover"
                  fill
                  priority={i === 0}
                  sizes="(max-width: 768px) 100vw, 50vw"
                  src={img.publicUrl}
                  unoptimized
                />
              )}
            </div>
          ))}
        </div>
      )}

      {offer.description && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">Описание</h2>
          <p className="whitespace-pre-wrap text-slate-600">{offer.description}</p>
        </section>
      )}

      <OfferAttributesList offer={offer} />

      <section className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">{business.name}</h2>
        <RevealContacts
          address={addressWithRegion}
          businessId={business.id}
          businessSlug={slug}
          offerId={offer.id}
          offerSlug={offer.slug}
          phone={null}
          surface="offer"
          website={null}
        />
      </section>

      {similar.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Другие предложения
          </h2>
          <div className="grid gap-6 sm:grid-cols-2">
            {similar.map((item) => (
              <BusinessOfferCard
                key={item.id}
                businessAlreadyClaimed={alreadyClaimed}
                businessSlug={slug}
                offer={item}
                presence={{
                  website: null,
                  instagramUrl: null,
                  googleMapsUrl: null,
                  googleRating: business.googleRating,
                  googleReviewsCount: business.googleReviewsCount,
                  latitude: business.latitude,
                  longitude: business.longitude,
                }}
              />
            ))}
          </div>
        </section>
      )}

      <script
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: offer.title,
            description: offer.shortDescription ?? offer.description,
            url: `${SITE_URL}/business/${slug}/offers/${offerSlug}`,
            offers: {
              "@type": "Offer",
              priceCurrency: offer.currency,
              availability: offer.isAvailable
                ? "https://schema.org/InStock"
                : "https://schema.org/OutOfStock",
            },
          }),
        }}
        type="application/ld+json"
      />
    </div>
  );
}
