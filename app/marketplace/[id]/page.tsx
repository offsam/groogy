import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketplaceListingProfileView } from "@/components/marketplace/MarketplaceListingProfileView";
import { ErrorState } from "@/components/ui/DataState";
import { isListingOwner } from "@/lib/listings/permissions";
import { getListingById } from "@/lib/listings/queries";
import { createServerClient } from "@/lib/supabase/server";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ claim?: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createServerClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://russianbusiness.ai";

  try {
    const listing = await getListingById(supabase, id);
    if (!listing) {
      return {
        title: "Объявление не найдено",
        robots: { index: false, follow: false },
      };
    }

    if (["removed", "rejected", "draft", "archived"].includes(listing.status)) {
      return {
        title: "Объявление недоступно",
        robots: { index: false, follow: false },
      };
    }

    const indexable =
      listing.status === "active" && listing.visibility === "public";
    const description =
      listing.description.trim().slice(0, 160) ||
      "Объявление на Marketplace — КРУГИ";
    const cover = listing.media?.[0]?.publicUrl ?? undefined;

    return {
      title: `${listing.title} — Marketplace`,
      description,
      alternates: { canonical: `${siteUrl}/marketplace/${listing.id}` },
      openGraph: {
        title: listing.title,
        description,
        url: `${siteUrl}/marketplace/${listing.id}`,
        images: cover ? [{ url: cover }] : undefined,
        type: "website",
      },
      robots: indexable ? undefined : { index: false, follow: false },
    };
  } catch {
    return {
      title: "Объявление — Marketplace",
      robots: { index: false, follow: false },
    };
  }
}

export default async function ListingDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { claim } = await searchParams;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let listing: Awaited<ReturnType<typeof getListingById>> = null;
  let loadError: string | null = null;

  try {
    listing = await getListingById(supabase, id, user?.id ?? null);
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Не удалось загрузить объявление";
  }

  if (loadError) {
    return <ErrorState detail={loadError} message="Объявление недоступно" />;
  }

  if (!listing) {
    notFound();
  }

  const isOwner = isListingOwner(listing, user?.id ?? null);
  const isAdmin = user
    ? Boolean((await supabase.rpc("is_admin")).data)
    : false;
  if (
    ["removed", "rejected"].includes(listing.status) &&
    !isOwner
  ) {
    // Owner may still see moderated listing; strangers get a noindex shell
    // without the original title (no existence enumeration beyond "unavailable").
    if (!isAdmin) {
      return (
        <div className="mx-auto max-w-lg py-16 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">
            Объявление недоступно
          </h1>
          <p className="mt-2 text-slate-600">
            Оно снято с публикации или отклонено модерацией.
          </p>
          <Link
            className="mt-6 inline-block text-sm font-medium text-slate-900 underline"
            href="/marketplace"
          >
            Вернуться в Marketplace
          </Link>
        </div>
      );
    }
  }

  const isPublic =
    listing.status === "active" &&
    (listing.visibility === "public" || listing.visibility === "unlisted");

  if (!isOwner && !isPublic && listing.visibility !== "public") {
    if (listing.status !== "active" || listing.visibility === "private") {
      notFound();
    }
  }

  if (
    !isOwner &&
    listing.visibility === "private"
  ) {
    notFound();
  }

  if (
    !isOwner &&
    !["active", "reserved", "completed"].includes(listing.status)
  ) {
    notFound();
  }

  return (
    <MarketplaceListingProfileView
      autoClaim={claim === "1" && Boolean(user) && !isOwner}
      currentUserId={user?.id ?? null}
      isAuthenticated={Boolean(user)}
      isAdmin={isAdmin}
      isOwner={isOwner}
      listing={listing}
    />
  );
}
