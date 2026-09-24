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
import { getMyProfessional } from "@/lib/professional/queries";
import {
  listPublicSkillFrames,
  listSkillFramesForOwner,
} from "@/lib/profile/skill-frame-queries";
import { listSearchFramesWithListings } from "@/lib/profile/search-history-queries";
import { getDismissedSearchNormsAction } from "@/lib/profile/search-history-actions";
import { createServerClient } from "@/lib/supabase/server";

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
  let publicSkillFrames: Awaited<ReturnType<typeof listPublicSkillFrames>> = [];
  let loadError: string | null = null;

  try {
    profile = await getPublicProfileByUsername(supabase, username);
    if (profile?.showListings && profile.mode === "public" && !profile.isSelf) {
      [listings, services] = await Promise.all([
        getPublicProfileListings(supabase, username),
        getPublicProfileServiceListings(supabase, username),
      ]);
    }
    if (profile?.ownerId && profile.mode === "public" && !profile.isSelf) {
      publicSkillFrames = await listPublicSkillFrames(
        supabase,
        profile.ownerId,
      ).catch(() => []);
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

  // Enrich cover when column exists but RPC not yet migrated.
  if (!profile.coverUrl && profile.ownerId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: coverRow } = await (supabase as any)
      .from("profiles")
      .select("cover_url")
      .eq("id", profile.ownerId)
      .maybeSingle();
    if (coverRow?.cover_url) {
      profile = { ...profile, coverUrl: coverRow.cover_url as string };
    }
  }

  // Public card: owner_id hidden — try username lookup for cover only when public.
  if (
    !profile.coverUrl &&
    !profile.isSelf &&
    profile.mode === "public" &&
    profile.username
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: coverRow } = await (supabase as any)
      .from("profiles")
      .select("cover_url")
      .eq("username", profile.username)
      .maybeSingle();
    if (coverRow?.cover_url) {
      profile = { ...profile, coverUrl: coverRow.cover_url as string };
    }
  }

  let self: ComponentProps<typeof PublicUserProfileView>["self"] = null;

  if (profile.isSelf && profile.ownerId) {
    const [
      myListings,
      myServices,
      businesses,
      professional,
      auth,
      skillFrames,
      searchFrames,
    ] = await Promise.all([
      getMyListings(supabase, profile.ownerId, null, "marketplace_item").catch(
        () => [],
      ),
      getMyListings(supabase, profile.ownerId, null, "service").catch(() => []),
      getOwnedBusinessesForPublisher(supabase, profile.ownerId).catch(() => []),
      getMyProfessional(supabase, profile.ownerId).catch(() => null),
      supabase.auth.getUser(),
      listSkillFramesForOwner(supabase, profile.ownerId).catch(() => []),
      getDismissedSearchNormsAction()
        .then((dismissed) =>
          listSearchFramesWithListings(supabase, profile.ownerId!, dismissed),
        )
        .catch(() => []),
    ]);

    self = {
      email: auth.data.user?.email ?? null,
      myListings,
      myServices,
      businesses,
      professional,
      skillFrames,
      searchFrames,
    };
  }

  return (
    <PublicUserProfileView
      listings={listings}
      profile={profile}
      publicSkillFrames={publicSkillFrames}
      self={self}
      services={services}
    />
  );
}
