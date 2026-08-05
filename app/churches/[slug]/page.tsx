import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChurchProfileView } from "@/components/churches/ChurchProfileView";
import { getCityCenter } from "@/lib/geo/city-center";
import {
  getChurchBySlug,
  getChurchOwnerBySlug,
} from "@/lib/churches/queries";
import { userIsAdmin } from "@/lib/reviews/queries";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

type PageProps = {
  params: Promise<{ slug: string }>;
};

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://example.com";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const catalog = createServiceRoleClient();
  const church = await getChurchBySlug(catalog, slug);
  if (!church) return { title: "Церковь не найдена" };
  return {
    title: `${church.name} — КРУГИ`,
    description:
      church.description?.slice(0, 160) ||
      `${church.name} — церковь в каталоге КРУГИ`,
    alternates: { canonical: `${SITE_URL}/churches/${slug}` },
  };
}

export default async function ChurchPage({ params }: PageProps) {
  const { slug } = await params;
  const client = await createServerClient();
  const catalog = createServiceRoleClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  let church = await getChurchBySlug(catalog, slug);
  let isAdmin = false;

  if (user) {
    isAdmin = await userIsAdmin(client).catch(() => false);
    if (isAdmin) {
      // Service role — full contacts; user client can fail silently under RLS.
      const owned = await getChurchOwnerBySlug(catalog, slug).catch(() => null);
      if (owned) church = owned;
    } else if (!church) {
      // draft only for admin
    }
  }

  if (!church) notFound();
  if (church.status !== "approved" && !isAdmin) notFound();

  const cityMapCenter = await getCityCenter(church.city, church.stateCode, {
    postalCode: church.postalCode,
    region: church.region,
  }).catch(() => null);

  return (
    <ChurchProfileView
      church={church}
      cityMapCenter={cityMapCenter}
      currentUserId={user?.id ?? null}
      isAdmin={isAdmin}
      preview={isAdmin && church.status !== "approved"}
    />
  );
}
