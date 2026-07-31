import Image from "next/image";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { ProfileSettingsForm } from "@/components/auth/ProfileSettingsForm";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { OwnListingArchiveButton } from "@/components/profile/OwnListingArchiveButton";
import { ServiceCard } from "@/components/services/ServiceCard";
import type { ProfileRow } from "@/types/database";
import type { Listing, OwnedBusinessOption, PublicProfileCard } from "@/types/listing";
import type { Professional } from "@/types/professional";
import type { UsStateOption } from "@/types/master-data";
import { cn } from "@/lib/utils";

function formatMemberSince(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(
    new Date(value),
  );
}

function CounterCell({
  value,
  label,
  hint,
}: {
  value: number;
  label: string;
  hint?: string | null;
}) {
  return (
    <div className="flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center px-1 py-2 text-center">
      <span className="text-base font-semibold tabular-nums text-slate-900 sm:text-lg">
        {value}
      </span>
      <span className="mt-0.5 truncate text-[11px] leading-tight text-slate-500 sm:text-xs">
        {label}
      </span>
      {hint ? (
        <span className="mt-0.5 truncate text-[10px] text-emerald-600">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

type Props = {
  profile: PublicProfileCard;
  listings: Listing[];
  services: Listing[];
  /** Self-only: full settings row + owned entities */
  self?: {
    profileRow: ProfileRow;
    usStates: UsStateOption[];
    email: string | null;
    myListings: Listing[];
    myServices: Listing[];
    businesses: OwnedBusinessOption[];
    professional: Professional | null;
  } | null;
};

export function PublicUserProfileView({
  profile,
  listings,
  services,
  self = null,
}: Props) {
  const isSelf = Boolean(profile.isSelf && self);
  const strangerPrivate =
    !isSelf &&
    (profile.mode === "private" || profile.mode === "private_preview");
  const location = [profile.city, profile.state].filter(Boolean).join(", ");
  const displayTitle = strangerPrivate
    ? profile.label
    : (profile.displayName ?? profile.label);
  const isPublicCard = profile.mode === "public" || isSelf;

  const counters: Array<{
    key: string;
    value: number;
    label: string;
    hint?: string | null;
  }> = [];

  if (isPublicCard && !strangerPrivate) {
    if (isSelf || profile.showReviews) {
      counters.push({
        key: "reviews",
        value: profile.reviewsPublishedCount,
        label: "Отзывы",
        hint:
          profile.reviewsAiVerifiedCount > 0
            ? `${profile.reviewsAiVerifiedCount} AI`
            : null,
      });
    }
    if (isSelf || profile.showListings) {
      counters.push({
        key: "listings",
        value: profile.listingsActiveCount,
        label: "Объявления",
      });
      counters.push({
        key: "services",
        value: profile.servicesActiveCount,
        label: "Услуги",
      });
    }
    counters.push({
      key: "circles",
      value: profile.circlesCount,
      label: "В кругах",
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div
          aria-hidden
          className="h-28 w-full bg-gradient-to-br from-brand-yellow via-brand-orange to-brand-blue sm:h-36"
        />

        <div className="px-4 pb-5 sm:px-6">
          <div className="-mt-10 flex items-end justify-between gap-3 sm:-mt-12">
            <div className="relative size-20 shrink-0 overflow-hidden rounded-full bg-slate-100 ring-4 ring-white sm:size-24">
              {profile.avatarUrl && !strangerPrivate ? (
                <Image
                  alt={displayTitle}
                  className="object-cover"
                  fill
                  sizes="96px"
                  src={profile.avatarUrl}
                  unoptimized
                />
              ) : (
                <div className="flex h-full items-center justify-center text-2xl font-semibold text-slate-400 sm:text-3xl">
                  {displayTitle.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            {isSelf ? (
              <a
                className="mb-1 inline-flex min-h-11 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 hover:bg-slate-50"
                href="#settings"
              >
                Настройки
              </a>
            ) : null}
          </div>

          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                {displayTitle}
              </h1>
              {isSelf && profile.mode !== "public" ? (
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  Приватный для других
                </span>
              ) : null}
            </div>
            {profile.username && !strangerPrivate ? (
              <p className="mt-0.5 text-sm text-slate-500">@{profile.username}</p>
            ) : null}
            {isSelf && self?.email ? (
              <p className="mt-1 text-xs text-slate-400">{self.email}</p>
            ) : null}
          </div>

          {strangerPrivate ? (
            <p className="mt-4 text-sm text-slate-500">
              Этот профиль приватный.
            </p>
          ) : (
            <>
              {counters.length > 0 ? (
                <div
                  className={cn(
                    "mt-4 flex divide-x divide-slate-100 border-y border-slate-100",
                    counters.length === 1 && "justify-center",
                  )}
                >
                  {counters.map((c) => (
                    <CounterCell
                      key={c.key}
                      hint={c.hint}
                      label={c.label}
                      value={c.value}
                    />
                  ))}
                </div>
              ) : null}

              {profile.bio ? (
                <p className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800">
                  {profile.bio}
                </p>
              ) : null}

              <div className="mt-3 space-y-1 text-sm text-slate-600">
                {location ? (
                  <p className="flex items-center gap-1.5">
                    <MapPin
                      aria-hidden
                      className="size-3.5 shrink-0 text-slate-400"
                    />
                    <span>{location}</span>
                  </p>
                ) : null}
                <p className="text-xs text-slate-400">
                  На платформе с {formatMemberSince(profile.memberSince)}
                  {profile.listingsCompletedCount > 0
                    ? ` · ${profile.listingsCompletedCount} завершённых`
                    : null}
                </p>
              </div>
            </>
          )}
        </div>
      </section>

      {isSelf && self ? (
        <>
          <section
            className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6"
            id="settings"
          >
            <h2 className="text-lg font-semibold text-slate-900">Настройки</h2>
            <p className="mt-1 text-sm text-slate-500">
              Имя, username, видимость и что показывать другим.
            </p>
            <div className="mt-4">
              <ProfileSettingsForm
                profile={self.profileRow}
                usStates={self.usStates}
              />
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-slate-900">Мои бизнесы</h2>
            {self.businesses.length === 0 ? (
              <p className="text-sm text-slate-500">
                Пока нет привязанных бизнесов.
              </p>
            ) : (
              <ul className="space-y-2">
                {self.businesses.map((b) => (
                  <li key={b.id}>
                    <Link
                      className="inline-flex min-h-11 items-center text-sm font-medium text-brand-blue hover:underline"
                      href={`/business/${b.slug}`}
                    >
                      {b.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-slate-900">
              Профиль специалиста
            </h2>
            {self.professional ? (
              <Link
                className="inline-flex min-h-11 items-center text-sm font-medium text-brand-blue hover:underline"
                href={`/professional/${self.professional.slug}`}
              >
                {self.professional.displayName}
              </Link>
            ) : (
              <p className="text-sm text-slate-500">
                Специалист к аккаунту не привязан.
              </p>
            )}
          </section>

          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">
                Мои объявления
              </h2>
              <Link
                className="inline-flex min-h-11 items-center rounded-lg bg-brand-blue px-3 text-sm font-medium text-white"
                href="/marketplace/new"
                style={{ color: "#ffffff" }}
              >
                Разместить
              </Link>
            </div>
            {self.myListings.length === 0 ? (
              <p className="text-sm text-slate-500">Нет объявлений.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
                {self.myListings.map((listing) => (
                  <div key={listing.id}>
                    <ListingCard listing={listing} showStatus />
                    {listing.status !== "archived" &&
                    listing.status !== "removed" ? (
                      <OwnListingArchiveButton listingId={listing.id} />
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">
                Мои услуги
              </h2>
              <Link
                className="inline-flex min-h-11 items-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-900 hover:bg-slate-50"
                href="/services/new"
              >
                Добавить услугу
              </Link>
            </div>
            {self.myServices.length === 0 ? (
              <p className="text-sm text-slate-500">Нет услуг.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
                {self.myServices.map((listing) => (
                  <div key={listing.id}>
                    <ServiceCard listing={listing} showStatus />
                    {listing.status !== "archived" &&
                    listing.status !== "removed" ? (
                      <OwnListingArchiveButton listingId={listing.id} />
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}

      {!isSelf && !strangerPrivate && profile.showListings ? (
        <>
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">
              Объявления
              <span className="ml-2 text-sm font-normal tabular-nums text-slate-500">
                {profile.listingsActiveCount}
              </span>
            </h2>
            {listings.length === 0 ? (
              <p className="text-sm text-slate-500">Нет публичных объявлений.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
                {listings.map((listing) => (
                  <ListingCard key={listing.id} listing={listing} />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">
              Услуги
              <span className="ml-2 text-sm font-normal tabular-nums text-slate-500">
                {profile.servicesActiveCount}
              </span>
            </h2>
            {services.length === 0 ? (
              <p className="text-sm text-slate-500">Нет публичных услуг.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
                {services.map((listing) => (
                  <ServiceCard key={listing.id} listing={listing} />
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
