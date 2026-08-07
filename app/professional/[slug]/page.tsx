import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProfessionalProfileView } from "@/components/professional/ProfessionalProfileView";
import { listPublishedCommunityMentionsForProfessional } from "@/lib/community-mentions/queries";
import { thirdPartySourceUrlsFromMentions } from "@/lib/community-mentions/source-urls";
import { getCityCenter } from "@/lib/geo/city-center";
import {
  getCachedProfessionalBySlug,
  getOwnedProfessionalBySlug,
  getProfessionalServices,
  userOwnsProfessional,
} from "@/lib/professional/queries";
import { userIsAdmin } from "@/lib/reviews/queries";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getProfessionalCategories } from "@/lib/supabase/queries";
import { listOwnerPromotions } from "@/lib/promotions/queries";
import {
  isFollowingOwner,
  listOwnerUpdates,
} from "@/lib/updates/queries";
import type { Category } from "@/types/business";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ claim?: string }>;
};

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://example.com";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const professional = await getCachedProfessionalBySlug(slug);
  if (!professional) return { title: "Специалист не найден" };
  return {
    title: `${professional.displayName} — КРУГИ`,
    description:
      professional.shortDescription ??
      professional.headline ??
      `${professional.displayName} — профиль специалиста`,
    alternates: { canonical: `${SITE_URL}/professional/${slug}` },
  };
}

export default async function ProfessionalPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { claim } = await searchParams;
  const client = await createServerClient();
  const catalog = createServiceRoleClient();
  const [
    {
      data: { user },
    },
    initialProfessional,
  ] = await Promise.all([
    client.auth.getUser(),
    getCachedProfessionalBySlug(slug),
  ]);

  let professional = initialProfessional;
  let ownsProfessional = false;
  let isAdmin = false;

  if (user) {
    isAdmin = await userIsAdmin(client).catch(() => false);

    if (!professional) {
      const owned = await getOwnedProfessionalBySlug(client, slug).catch(() => null);
      if (owned) {
        professional = owned;
        ownsProfessional = true;
      }
    } else {
      ownsProfessional = await userOwnsProfessional(client, professional.id).catch(
        () => false,
      );
      if (ownsProfessional || isAdmin) {
        const owned = await getOwnedProfessionalBySlug(client, slug).catch(() => null);
        if (owned) professional = owned;
      }
    }
  }

  if (!professional) notFound();

  const isOwner = ownsProfessional || isAdmin;
  const autoClaim = claim === "1" && Boolean(user) && !ownsProfessional && !isAdmin;

  const hasStreetCoords =
    typeof professional.latitude === "number" &&
    typeof professional.longitude === "number" &&
    Number.isFinite(professional.latitude) &&
    Number.isFinite(professional.longitude) &&
    professional.locationPrecision === "street" &&
    Boolean(professional.addressLine?.trim());

  const [services, categories, communityMentions, promotions, updates, following, cityMapCenter] =
    await Promise.all([
    getProfessionalServices(catalog, professional.id).catch(() => []),
    isAdmin
      ? getProfessionalCategories(catalog).catch(() => [] as Category[])
      : Promise.resolve([] as Category[]),
    listPublishedCommunityMentionsForProfessional(catalog, professional.id).catch(
      () => [],
    ),
    listOwnerPromotions(catalog, "professional", professional.id).catch(() => []),
    listOwnerUpdates(catalog, "professional", professional.id).catch(() => []),
    user
      ? isFollowingOwner(client, user.id, "professional", professional.id).catch(
          () => false,
        )
      : Promise.resolve(false),
    hasStreetCoords
      ? Promise.resolve(null)
      : getCityCenter(professional.city, professional.stateCode, {
          postalCode: professional.postalCode,
          region: professional.region,
        }).catch(() => null),
  ]);

  const communitySourceUrls = thirdPartySourceUrlsFromMentions(
    communityMentions.map((m) => ({
      sourceUrl: m.sourceUrl,
      kind: m.kind,
    })),
  );

  return (
    <ProfessionalProfileView
      autoClaim={autoClaim}
      categories={categories}
      cityMapCenter={cityMapCenter}
      communitySourceUrls={communitySourceUrls}
      currentUserId={user?.id ?? null}
      initialFollowing={following}
      isAdmin={isAdmin}
      isOwner={isOwner}
      professional={professional}
      promotions={promotions}
      services={services}
      updates={updates}
    />
  );
}
