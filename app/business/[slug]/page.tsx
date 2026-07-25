import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BusinessProfileView } from "@/components/business/profile/BusinessProfileView";
import { getPublicOffersForBusiness } from "@/lib/business-offers/queries";
import { hasRealBusinessPhoto } from "@/lib/business/media";
import { createServerClient } from "@/lib/supabase/server";
import {
  getApprovedBusinesses,
  getBusinessBySlug,
  searchBusinesses,
} from "@/lib/supabase/queries";
import {
  getMyReviewForBusiness,
  getPublishedReviewsForBusiness,
  getVerificationSessionForReview,
  userIsAdmin,
  userOwnsBusiness,
} from "@/lib/reviews/queries";
import type { Business } from "@/types/business";
import type { Review, ReviewVerificationSession } from "@/types/review";

type BusinessPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ claim?: string; tab?: string; edit?: string }>;
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
  const { claim, tab, edit } = await searchParams;
  const client = await createServerClient();
  const business = await getBusinessBySlug(client, slug);
  if (!business) notFound();

  const {
    data: { user },
  } = await client.auth.getUser();

  const [offers, published, owns, isAdmin, similarPool] = await Promise.all([
    getPublicOffersForBusiness(client, business.id),
    getPublishedReviewsForBusiness(client, business.id).catch(() => []),
    user ? userOwnsBusiness(client, business.id) : Promise.resolve(false),
    user ? userIsAdmin(client).catch(() => false) : Promise.resolve(false),
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

  const canManage = owns || isAdmin;
  const autoClaim = claim === "1" && Boolean(user) && !canManage;
  const editMode = edit === "1" && canManage;
  const cityOnly = business.city?.trim() || "";

  return (
    <>
      <BusinessProfileView
        activeTab={tab}
        autoClaim={autoClaim}
        business={business}
        businessSlug={slug}
        currentUserId={user?.id ?? null}
        editMode={editMode}
        isAdmin={isAdmin}
        isOwner={canManage}
        myReview={myReview}
        mySession={mySession}
        offers={offers}
        reviews={reviews}
        similar={similar}
      />

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
    </>
  );
}
