import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { ServiceCard } from "@/components/services/ServiceCard";
import { ErrorState } from "@/components/ui/DataState";
import {
  getPublicProfileByUsername,
  getPublicProfileListings,
  getPublicProfileServiceListings,
} from "@/lib/listings/queries";
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
    if (profile.mode !== "public") {
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(
    new Date(value),
  );
}

export default async function PublicProfilePage({ params }: PageProps) {
  const { username } = await params;
  const supabase = await createServerClient();

  let profile: Awaited<ReturnType<typeof getPublicProfileByUsername>> = null;
  let listings: Awaited<ReturnType<typeof getPublicProfileListings>> = [];
  let services: Awaited<ReturnType<typeof getPublicProfileServiceListings>> = [];
  let loadError: string | null = null;

  try {
    profile = await getPublicProfileByUsername(supabase, username);
    if (profile?.showListings && profile.mode === "public") {
      [listings, services] = await Promise.all([
        getPublicProfileListings(supabase, username),
        getPublicProfileServiceListings(supabase, username),
      ]);
    }
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Не удалось загрузить профиль";
  }

  if (loadError) {
    return <ErrorState detail={loadError} message="Профиль недоступен" />;
  }

  if (!profile) {
    notFound();
  }

  const location = [profile.city, profile.state].filter(Boolean).join(", ");
  const isPrivate = profile.mode === "private" || profile.mode === "private_preview";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start gap-4">
          <div className="relative size-20 shrink-0 overflow-hidden rounded-full bg-slate-100">
            {profile.avatarUrl && !isPrivate ? (
              <Image
                alt={profile.label}
                className="object-cover"
                fill
                sizes="80px"
                src={profile.avatarUrl}
                unoptimized
              />
            ) : (
              <div className="flex h-full items-center justify-center text-2xl font-semibold text-slate-400">
                {profile.label.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">
                  {isPrivate ? profile.label : (profile.displayName ?? profile.label)}
                </h1>
                {profile.username && !isPrivate && (
                  <p className="text-sm text-slate-500">@{profile.username}</p>
                )}
              </div>
              {profile.isSelf && (
                <Link
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
                  href="/profile"
                >
                  Настройки
                </Link>
              )}
            </div>

            {isPrivate ? (
              <p className="mt-3 text-sm text-slate-500">
                Этот профиль приватный.
              </p>
            ) : (
              <>
                {profile.bio && (
                  <p className="mt-3 whitespace-pre-wrap text-slate-700">{profile.bio}</p>
                )}
                {location && (
                  <p className="mt-2 flex items-center gap-1 text-sm text-slate-600">
                    <MapPin aria-hidden="true" className="size-3.5 text-slate-400" />
                    {location}
                  </p>
                )}
                <p className="mt-2 text-xs text-slate-400">
                  На платформе с {formatDate(profile.memberSince)}
                </p>

                {profile.showReviews && (
                  <dl className="mt-4 flex flex-wrap gap-4 text-sm">
                    <div>
                      <dt className="text-slate-500">Отзывы</dt>
                      <dd className="font-semibold text-slate-900">
                        {profile.reviewsPublishedCount}
                        {profile.reviewsAiVerifiedCount > 0 && (
                          <span className="ml-1 text-xs font-normal text-emerald-600">
                            ({profile.reviewsAiVerifiedCount} AI)
                          </span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Объявления</dt>
                      <dd className="font-semibold text-slate-900">
                        {profile.listingsActiveCount} активных ·{" "}
                        {profile.listingsCompletedCount} завершённых
                      </dd>
                    </div>
                  </dl>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {!isPrivate && profile.showListings && profile.ownerId && (
        <>
          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">Объявления</h2>
            {listings.length === 0 ? (
              <p className="text-sm text-slate-500">Нет публичных объявлений.</p>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2">
                {listings.map((listing) => (
                  <ListingCard key={listing.id} listing={listing} />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">Услуги</h2>
            {services.length === 0 ? (
              <p className="text-sm text-slate-500">Нет публичных услуг.</p>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2">
                {services.map((listing) => (
                  <ServiceCard key={listing.id} listing={listing} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
