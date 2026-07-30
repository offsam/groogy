import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProfessionalProfileView } from "@/components/professional/ProfessionalProfileView";
import { listPublishedCommunityMentionsForProfessional } from "@/lib/community-mentions/queries";
import { thirdPartySourceUrlsFromMentions } from "@/lib/community-mentions/source-urls";
import {
  getOwnedProfessionalBySlug,
  getProfessionalBySlug,
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
};

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://example.com";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const catalog = createServiceRoleClient();
  const professional = await getProfessionalBySlug(catalog, slug);
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

export default async function ProfessionalPage({ params }: PageProps) {
  const { slug } = await params;
  const client = await createServerClient();
  const catalog = createServiceRoleClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  let professional = await getProfessionalBySlug(catalog, slug);
  let isOwner = false;
  let isAdmin = false;

  if (user) {
    isAdmin = await userIsAdmin(client).catch(() => false);

    if (!professional) {
      const owned = await getOwnedProfessionalBySlug(client, slug).catch(() => null);
      if (owned) {
        professional = owned;
        isOwner = true;
      }
    } else {
      isOwner =
        (await userOwnsProfessional(client, professional.id).catch(() => false)) ||
        isAdmin;
      if (isOwner) {
        const owned = await getOwnedProfessionalBySlug(client, slug).catch(() => null);
        if (owned) professional = owned;
      }
    }

    if (professional && isAdmin) isOwner = true;
  }

  if (!professional) notFound();

  const [services, categories, communityMentions, promotions, updates, following] =
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
  ]);

  const communitySourceUrls = thirdPartySourceUrlsFromMentions(
    communityMentions.map((m) => ({
      sourceUrl: m.sourceUrl,
      kind: m.kind,
    })),
  );

  return (
    <ProfessionalProfileView
      categories={categories}
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
