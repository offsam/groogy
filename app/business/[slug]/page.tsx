import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BusinessProfileView } from "@/components/business/profile/BusinessProfileView";
import { SyncHubCookie } from "@/components/layout/SyncHubCookie";
import { getPublicOffersForBusiness } from "@/lib/business-offers/queries";
import { listPublishedCommunityMentionsForBusiness } from "@/lib/community-mentions/queries";
import { listPublishedBusinessLocations } from "@/lib/business/locations";
import { listJobsForBusiness } from "@/lib/jobs/queries";
import { hasRealBusinessPhoto } from "@/lib/business/media";
import { resolveRequestHubs } from "@/lib/regions/request-hub";
import { serializeHubIds } from "@/lib/regions/hubs";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { formatAddress, stripBusinessContacts } from "@/lib/supabase/mappers";
import { redactContactsFromPublicText } from "@/lib/content/structure-business-profile";
import {
  getActiveCategories,
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
import { getBusinessEngagement } from "@/lib/engagement/queries";
import type { Business, Category } from "@/types/business";
import type { Review, ReviewVerificationSession } from "@/types/review";
import type { EntityEngagement } from "@/types/engagement";

type BusinessPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    claim?: string;
    edit?: string;
    tab?: string;
    hub?: string;
  }>;
};

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://example.com";

export async function generateMetadata({
  params,
}: BusinessPageProps): Promise<Metadata> {
  const { slug } = await params;
  const catalog = createServiceRoleClient();
  const business = await getBusinessBySlug(catalog, slug);
  if (!business) return { title: "Бизнес не найден" };

  const description =
    redactContactsFromPublicText(
      business.shortDescription ??
        business.description?.slice(0, 160) ??
        null,
    ) ?? `${business.name} — профиль компании на платформе.`;

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
  const { claim, tab, edit, hub } = await searchParams;
  const activeHubs = await resolveRequestHubs(hub);
  const hubIds = serializeHubIds(activeHubs.map((h) => h.id));
  const client = await createServerClient();
  const catalog = createServiceRoleClient();
  const fullBusiness = await getBusinessBySlug(catalog, slug);
  if (!fullBusiness) notFound();

  const {
    data: { user },
  } = await client.auth.getUser();

  const [offers, published, owns, isAdmin, similarPool, communityMentions, locations, categories, engagement] =
    await Promise.all([
    getPublicOffersForBusiness(client, fullBusiness.id, {
      businessSlug: fullBusiness.slug,
      businessName: fullBusiness.name,
    }),
    getPublishedReviewsForBusiness(catalog, fullBusiness.id).catch((err) => {
      console.error("[business/reviews]", err);
      return [] as Review[];
    }),
    user ? userOwnsBusiness(client, fullBusiness.id) : Promise.resolve(false),
    user ? userIsAdmin(client).catch(() => false) : Promise.resolve(false),
    fullBusiness.categoryId
      ? searchBusinesses(catalog, { categoryId: fullBusiness.categoryId })
      : getApprovedBusinesses(catalog, 12),
    listPublishedCommunityMentionsForBusiness(catalog, fullBusiness.id).catch(
      () => [],
    ),
    listPublishedBusinessLocations(catalog, fullBusiness.id).catch(() => []),
    getActiveCategories(catalog).catch(() => [] as Category[]),
    getBusinessEngagement(client, fullBusiness.id, user?.id ?? null, {
      likesCount: fullBusiness.likesCount ?? 0,
      followersCount: fullBusiness.followersCount ?? 0,
    }).catch(
      (): EntityEngagement => ({
        likesCount: fullBusiness.likesCount ?? 0,
        followersCount: fullBusiness.followersCount ?? 0,
        likedByMe: false,
        followedByMe: false,
      }),
    ),
  ]);

  const canManageEarly = owns || isAdmin;
  const jobs = await listJobsForBusiness(catalog, fullBusiness.id, {
    includeDrafts: canManageEarly,
  }).catch(() => []);

  let myReview = null;
  let mySession: ReviewVerificationSession | null = null;
  if (user) {
    myReview = await getMyReviewForBusiness(client, fullBusiness.id, user.id);
    if (myReview) {
      mySession = await getVerificationSessionForReview(client, myReview.id);
    }
  }

  const reviews = published as Review[];
  const similar = (similarPool as Business[])
    .filter((b) => b.id !== fullBusiness.id)
    .slice(0, 4);

  const canManage = owns || isAdmin;
  const autoClaim = claim === "1" && Boolean(user) && !canManage;
  const editMode = edit === "1" && canManage;
  // Outside edit mode everyone gets stripped contacts — reveal loads via API.
  const business = editMode ? fullBusiness : stripBusinessContacts(fullBusiness);
  const publicAddress = formatAddress(fullBusiness);

  return (
    <>
      <SyncHubCookie hubId={hubIds} />
      <BusinessProfileView
        activeTab={tab}
        activeHubs={activeHubs}
        autoClaim={autoClaim}
        business={business}
        businessSlug={slug}
        currentUserId={user?.id ?? null}
        editMode={editMode}
        isAdmin={isAdmin}
        isOwner={canManage}
        categories={isAdmin ? categories : []}
        myReview={myReview}
        mySession={mySession}
        offers={offers}
        jobs={jobs}
        reviews={reviews}
        engagement={engagement}
        communityMentions={communityMentions}
        locations={locations}
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
            address: publicAddress
              ? {
                  "@type": "PostalAddress",
                  streetAddress: fullBusiness.addressLine ?? undefined,
                  addressLocality: fullBusiness.city ?? undefined,
                  addressRegion: fullBusiness.region ?? undefined,
                }
              : undefined,
          }),
        }}
        type="application/ld+json"
      />
    </>
  );
}
