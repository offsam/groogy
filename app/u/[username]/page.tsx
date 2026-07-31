import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ComponentProps } from "react";
import { PublicUserProfileView } from "@/components/profile/PublicUserProfileView";
import { ErrorState } from "@/components/ui/DataState";
import {
  getMyListings,
  getOwnedBusinessesForPublisher,
  getPublicProfileByUsername,
  getPublicProfileListings,
  getPublicProfileServiceListings,
} from "@/lib/listings/queries";
import { getUsStates } from "@/lib/master-data/queries";
import { getMyProfessional } from "@/lib/professional/queries";
import { createServerClient } from "@/lib/supabase/server";
import { getProfileById } from "@/lib/supabase/queries";

type PageProps = {
  params: Promise<{ username: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { username } = await params;
  const supabase = await createServerClient();

  try {
    const profile = await getPublicProfileByUsername(supabase, username);
    if (!profile) return { title: "Профиль не найден" };
    if (profile.mode !== "public" && !profile.isSelf) {
      return {
        title: "Приватный профиль",
        robots: { index: false, follow: false },
      };
    }
    return {
      title: `${profile.displayName ?? profile.label} — @${username}`,
    };
  } catch {
    return { title: `@${username}` };
  }
}

export default async function PublicProfilePage({ params }: PageProps) {
  const { username } = await params;
  const supabase = await createServerClient();

  let profile: Awaited<ReturnType<typeof getPublicProfileByUsername>> = null;
  let listings: Awaited<ReturnType<typeof getPublicProfileListings>> = [];
  let services: Awaited<ReturnType<typeof getPublicProfileServiceListings>> =
    [];
  let loadError: string | null = null;

  try {
    profile = await getPublicProfileByUsername(supabase, username);
    if (profile?.showListings && profile.mode === "public" && !profile.isSelf) {
      [listings, services] = await Promise.all([
        getPublicProfileListings(supabase, username),
        getPublicProfileServiceListings(supabase, username),
      ]);
    }
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "Не удалось загрузить профиль";
  }

  if (loadError) {
    return <ErrorState detail={loadError} message="Профиль недоступен" />;
  }

  if (!profile) {
    notFound();
  }

  let self: ComponentProps<typeof PublicUserProfileView>["self"] = null;

  if (profile.isSelf && profile.ownerId) {
    const [
      profileRow,
      usStates,
      myListings,
      myServices,
      businesses,
      professional,
      auth,
    ] = await Promise.all([
      getProfileById(supabase, profile.ownerId),
      getUsStates().catch(() => []),
      getMyListings(supabase, profile.ownerId, null, "marketplace_item").catch(
        () => [],
      ),
      getMyListings(supabase, profile.ownerId, null, "service").catch(() => []),
      getOwnedBusinessesForPublisher(supabase, profile.ownerId).catch(() => []),
      getMyProfessional(supabase, profile.ownerId).catch(() => null),
      supabase.auth.getUser(),
    ]);

    if (profileRow) {
      self = {
        profileRow,
        usStates,
        email: auth.data.user?.email ?? null,
        myListings,
        myServices,
        businesses,
        professional,
      };
    }
  }

  return (
    <PublicUserProfileView
      listings={listings}
      profile={profile}
      self={self}
      services={services}
    />
  );
}
