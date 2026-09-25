import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ComponentProps } from "react";
import { PublicUserProfileView } from "@/components/profile/PublicUserProfileView";
import { ErrorState } from "@/components/ui/DataState";
import {
  getMyListings,
  getPublicProfileByUsername,
  getPublicProfileListings,
  getPublicProfileServiceListings,
} from "@/lib/listings/queries";
import { listPublishedEventsForOwner } from "@/lib/events/queries";
import { listApprovedBusinessesForProfileOwner } from "@/lib/supabase/queries";
import { getMyProfessional } from "@/lib/professional/queries";
import { listMyPendingBusinessClaims } from "@/lib/claims/queries";
import {
  listPublicSkillFrames,
  listSkillFramesForOwner,
} from "@/lib/profile/skill-frame-queries";
import { listSearchFramesWithListings } from "@/lib/profile/search-history-queries";
import { getDismissedSearchNormsAction } from "@/lib/profile/search-history-actions";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import type { Listing } from "@/types/listing";
import type { Business } from "@/types/business";
import type { PlatformEvent } from "@/lib/events/queries";

type PageProps = {
  params: Promise<{ username: string }>;
};

function onlyActive(listings: Listing[]): Listing[] {
  return listings.filter((l) => l.status === "active");
}

/** Same “current” set as /me/listings — not archived/removed. */
function currentMarketplaceListings(listings: Listing[]): Listing[] {
  return listings.filter(
    (l) =>
      l.status !== "archived" &&
      l.status !== "removed" &&
      l.status !== "rejected",
  );
}

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
  let listings: Listing[] = [];
  let services: Listing[] = [];
  let businesses: Business[] = [];
  let events: PlatformEvent[] = [];
  let publicSkillFrames: Awaited<ReturnType<typeof listPublicSkillFrames>> = [];
  let loadError: string | null = null;

  try {
    profile = await getPublicProfileByUsername(supabase, username);

    if (profile?.isSelf && profile.ownerId) {
      const [myListings, myServices, myBusinesses, myEvents] =
        await Promise.all([
          getMyListings(supabase, profile.ownerId, null, "marketplace_item")
            .then(currentMarketplaceListings)
            .catch(() => []),
          getMyListings(supabase, profile.ownerId, null, "service")
            .then(currentMarketplaceListings)
            .catch(() => []),
          listApprovedBusinessesForProfileOwner(profile.ownerId).catch(() => []),
          listPublishedEventsForOwner(supabase, profile.ownerId).catch(() => []),
        ]);
      listings = myListings;
      services = myServices;
      businesses = myBusinesses;
      events = myEvents;
    } else if (profile?.mode === "public") {
      const loadListings = Boolean(profile.showListings);
      let ownerId = profile.ownerId;
      if (!ownerId && profile.username) {
        // Public RPC hides owner_id from strangers; resolve for activity blocks only.
        try {
          const catalog = createServiceRoleClient();
          const { data: idRow } = await catalog
            .from("profiles")
            .select("id")
            .eq("username", profile.username)
            .maybeSingle();
          ownerId = (idRow?.id as string | undefined) ?? null;
        } catch {
          ownerId = null;
        }
      }
      const [publicListings, publicServices, publicBusinesses, publicEvents] =
        await Promise.all([
          loadListings
            ? getPublicProfileListings(supabase, username)
                .then(onlyActive)
                .catch(() => [])
            : Promise.resolve([] as Listing[]),
          loadListings
            ? getPublicProfileServiceListings(supabase, username)
                .then(onlyActive)
                .catch(() => [])
            : Promise.resolve([] as Listing[]),
          ownerId
            ? listApprovedBusinessesForProfileOwner(ownerId).catch(() => [])
            : Promise.resolve([] as Business[]),
          ownerId
            ? listPublishedEventsForOwner(supabase, ownerId).catch(() => [])
            : Promise.resolve([] as PlatformEvent[]),
        ]);
      listings = publicListings;
      services = publicServices;
      businesses = publicBusinesses;
      events = publicEvents;

      if (ownerId) {
        publicSkillFrames = await listPublicSkillFrames(supabase, ownerId).catch(
          () => [],
        );
      }
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
      pendingBusinessClaims,
      professional,
      auth,
      skillFrames,
      searchFrames,
    ] = await Promise.all([
      listMyPendingBusinessClaims(supabase, profile.ownerId).catch(() => []),
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
      pendingBusinessClaims,
      professional,
      skillFrames,
      searchFrames,
    };
  }

  return (
    <PublicUserProfileView
      businesses={businesses}
      events={events}
      listings={listings}
      profile={profile}
      publicSkillFrames={publicSkillFrames}
      self={self}
      services={services}
    />
  );
}
