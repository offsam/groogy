import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { BusinessCard } from "@/components/business/BusinessCard";
import { BusinessHero } from "@/components/business/BusinessHero";
import { RevealContacts } from "@/components/business/RevealContacts";
import { BusinessOffersSection } from "@/components/business-offers/BusinessOffersSection";
import { BusinessReviewsSection } from "@/components/reviews/BusinessReviewsSection";
import { getPublicOffersForBusiness } from "@/lib/business-offers/queries";
import { hasRealBusinessPhoto } from "@/lib/business/media";
import { createServerClient } from "@/lib/supabase/server";
import {
  getApprovedBusinesses,
  getBusinessBySlug,
  searchBusinesses,
} from "@/lib/supabase/queries";
import { formatAddress } from "@/lib/supabase/mappers";
import {
  getMyReviewForBusiness,
  getPublishedReviewsForBusiness,
  getVerificationSessionForReview,
  userOwnsBusiness,
} from "@/lib/reviews/queries";
import type { Business } from "@/types/business";
import type { Review, ReviewVerificationSession } from "@/types/review";

type BusinessPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ claim?: string }>;
};

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://example.com";

export async function generateMetadata({
  params,
}: BusinessPageProps): Promise<Metadata> {
  const { slug } = await params;
  const client = await createServerClient();
  const business = await getBusinessBySlug(client, slug);
  if (!business) return { title: "Бизнес не найден" };

  const description =
    business.shortDescription ??
    business.description?.slice(0, 160) ??
    `${business.name} — профиль компании на платформе.`;

  return {
    title: `${business.name} — КРУГИ`,
    description,
    alternates: { canonical: `${SITE_URL}/business/${slug}` },
    openGraph: {
      title: business.name,
      description,
      url: `${SITE_URL}/business/${slug}`,
      images:
        business.imageUrl && hasRealBusinessPhoto(business.imageUrl)
          ? [{ url: business.imageUrl }]
          : undefined,
    },
  };
}

export default async function BusinessPage({ params, searchParams }: BusinessPageProps) {
  const { slug } = await params;
  const { claim } = await searchParams;
  const client = await createServerClient();
  const business = await getBusinessBySlug(client, slug);
  if (!business) notFound();

  const {
    data: { user },
  } = await client.auth.getUser();

  const [offers, published, owns, similarPool] = await Promise.all([
    getPublicOffersForBusiness(client, business.id),
    getPublishedReviewsForBusiness(client, business.id).catch(() => []),
    user ? userOwnsBusiness(client, business.id) : Promise.resolve(false),
    business.categoryId
      ? searchBusinesses(client, { categoryId: business.categoryId })
      : getApprovedBusinesses(client, 12),
  ]);

  let myReview = null;
  let mySession: ReviewVerificationSession | null = null;
  if (user) {
    myReview = await getMyReviewForBusiness(client, business.id, user.id);
    if (myReview) {
      mySession = await getVerificationSessionForReview(client, myReview.id);
    }
  }

  const reviews = published as Review[];
  const similar = (similarPool as Business[])
    .filter((b) => b.id !== business.id)
    .slice(0, 4);

  const address = formatAddress(business);
  const addressWithRegion =
    address && business.region ? `${address}, ${business.region}` : address;
  const showGallery = hasRealBusinessPhoto(business.imageUrl);
  const cityOnly = business.city?.trim() || "";
  const autoClaim = claim === "1" && Boolean(user) && !owns;

  return (
    <div className="mx-auto max-w-5xl space-y-10 pb-12">
      <Link
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
        href="/search"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Назад к поиску
      </Link>

      <BusinessHero
        autoClaim={autoClaim}
        business={business}
        businessSlug={slug}
        isOwner={owns}
      />

      {cityOnly ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="sr-only">Основная информация</h2>
          <p className="text-sm text-slate-700">{cityOnly}</p>
        </section>
      ) : null}

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-semibold text-slate-900">Контакты</h2>
        <RevealContacts
          address={addressWithRegion}
          businessId={business.id}
          businessSlug={slug}
          initiallyRevealed={owns}
          phone={business.phone}
          surface="business"
          website={business.website}
        />
      </section>

      {business.description && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">О компании</h2>
          <p className="whitespace-pre-wrap text-slate-600">{business.description}</p>
        </section>
      )}

      {showGallery && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">Галерея</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-100">
              <Image
                alt={business.name}
                className="object-cover"
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                src={business.imageUrl!}
                unoptimized
              />
            </div>
          </div>
        </section>
      )}

      <BusinessOffersSection
        businessSlug={slug}
        offers={offers}
        presence={{
          website: business.website,
          instagramUrl: business.instagramUrl,
          googleMapsUrl: business.googleMapsUrl,
          googleRating: business.googleRating,
          googleReviewsCount: business.googleReviewsCount,
          latitude: business.latitude,
          longitude: business.longitude,
        }}
      />

      <BusinessReviewsSection
        aiVerifiedCount={business.aiVerifiedReviewsCount}
        businessId={business.id}
        businessSlug={business.slug}
        currentUserId={user?.id ?? null}
        isOwner={owns}
        myReview={myReview}
        mySession={mySession}
        ratingAvg={business.ratingAvg}
        reviews={reviews}
        reviewsCount={business.reviewsCount}
        transactionVerifiedCount={business.transactionVerifiedReviewsCount}
      />

      {similar.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-slate-900">Похожие бизнесы</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {similar.map((item) => (
              <BusinessCard key={item.id} business={item} />
            ))}
          </div>
        </section>
      )}

      <script
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "LocalBusiness",
            name: business.name,
            description: business.shortDescription ?? business.description,
            url: `${SITE_URL}/business/${slug}`,
            address: cityOnly
              ? {
                  "@type": "PostalAddress",
                  addressLocality: business.city,
                  addressRegion: business.region,
                }
              : undefined,
          }),
        }}
        type="application/ld+json"
      />
    </div>
  );
}
