import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProfessionalProfileView } from "@/components/professional/ProfessionalProfileView";
import {
  getOwnedProfessionalBySlug,
  getProfessionalBySlug,
  getProfessionalServices,
  userOwnsProfessional,
} from "@/lib/professional/queries";
import { getProfessionalEngagement } from "@/lib/engagement/queries";
import { userIsAdmin } from "@/lib/reviews/queries";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import type { EntityEngagement } from "@/types/engagement";

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

  if (user) {
    const isAdmin = await userIsAdmin(client).catch(() => false);

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

  const services = await getProfessionalServices(catalog, professional.id).catch(
    () => [],
  );

  const engagement = await getProfessionalEngagement(
    client,
    professional.id,
    user?.id ?? null,
    {
      likesCount: professional.likesCount ?? 0,
      followersCount: professional.followersCount ?? 0,
    },
  ).catch(
    (): EntityEngagement => ({
      likesCount: professional.likesCount ?? 0,
      followersCount: professional.followersCount ?? 0,
      likedByMe: false,
      followedByMe: false,
    }),
  );

  return (
    <ProfessionalProfileView
      currentUserId={user?.id ?? null}
      engagement={engagement}
      isOwner={isOwner}
      professional={professional}
      services={services}
    />
  );
}
