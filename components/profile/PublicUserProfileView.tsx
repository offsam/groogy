import Image from "next/image";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { BusinessCard } from "@/components/business/BusinessCard";
import { EventCard } from "@/components/events/EventCard";
import { MyListingsFrame } from "@/components/profile/MyListingsFrame";
import { MyServicesFrame } from "@/components/profile/MyServicesFrame";
import { CabinetLeftNav } from "@/components/profile/CabinetLeftNav";
import { ProfileAvatarUpload } from "@/components/profile/ProfileAvatarUpload";
import { ProfileCoverBanner } from "@/components/profile/ProfileCoverBanner";
import { SkillFramesPanel } from "@/components/profile/SkillFramesPanel";
import { SearchFramesPanel } from "@/components/profile/SearchFramesPanel";
import type { ProfileSkillFrame } from "@/types/profile-cabinet";
import type { SearchFrameWithListings } from "@/lib/profile/search-history-queries";
import type { PlatformEvent } from "@/lib/events/queries";
import type { Listing, PublicProfileCard } from "@/types/listing";
import type { Business } from "@/types/business";
import type { Professional } from "@/types/professional";
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
  businesses?: Business[];
  events?: PlatformEvent[];
  publicSkillFrames?: ProfileSkillFrame[];
  /** Self-only: owned entities + cabinet panels */
  self?: {
    email: string | null;
    pendingBusinessClaims: Array<{
      claimId: string;
      businessId: string;
      name: string;
      slug: string;
    }>;
    professional: Professional | null;
    skillFrames: ProfileSkillFrame[];
    searchFrames: SearchFrameWithListings[];
  } | null;
};

function ProfileActivitySections({
  listings,
  services,
  businesses,
  events,
  listingsTitle = "Объявления",
  listingsAllHref = null,
  showListingStatus = false,
  servicesTitle = "Услуги",
  servicesAllHref = null,
  showServiceStatus = false,
}: {
  listings: Listing[];
  services: Listing[];
  businesses: Business[];
  events: PlatformEvent[];
  listingsTitle?: string;
  listingsAllHref?: string | null;
  showListingStatus?: boolean;
  servicesTitle?: string;
  servicesAllHref?: string | null;
  showServiceStatus?: boolean;
}) {
  if (
    listings.length === 0 &&
    services.length === 0 &&
    businesses.length === 0 &&
    events.length === 0
  ) {
    return null;
  }

  return (
    <>
      <MyListingsFrame
        allHref={listingsAllHref}
        listings={listings}
        showStatus={showListingStatus}
        title={listingsTitle}
      />

      <MyServicesFrame
        allHref={servicesAllHref}
        services={services}
        showStatus={showServiceStatus}
        title={servicesTitle}
      />

      {businesses.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Бизнесы
            <span className="ml-2 text-sm font-normal tabular-nums text-slate-500">
              {businesses.length}
            </span>
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
            {businesses.map((business) => (
              <BusinessCard business={business} key={business.id} />
            ))}
          </div>
        </section>
      ) : null}

      {events.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">
            События
            <span className="ml-2 text-sm font-normal tabular-nums text-slate-500">
              {events.length}
            </span>
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
            {events.map((event) => (
              <EventCard event={event} key={event.id} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

export function PublicUserProfileView({
  profile,
  listings,
  services,
  businesses = [],
  events = [],
  publicSkillFrames = [],
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

  const headerCard = (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <ProfileCoverBanner
        coverUrl={strangerPrivate ? null : profile.coverUrl}
        editable={isSelf}
        userId={isSelf ? profile.ownerId : null}
      />

      <div className="px-4 pb-5 sm:px-6">
        <div className="-mt-10 flex items-end justify-between gap-3 sm:-mt-12">
          {isSelf ? (
            <ProfileAvatarUpload
              avatarUrl={profile.avatarUrl}
              displayTitle={displayTitle}
            />
          ) : (
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
          )}

          {isSelf ? (
            <Link
              className="mb-1 inline-flex min-h-11 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 hover:bg-slate-50"
              href="/me/settings"
            >
              Настройки
            </Link>
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
  );

  const centerSelf =
    isSelf && self ? (
      <>
        {headerCard}

        {self.pendingBusinessClaims.length > 0 ? (
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-slate-900">
              Мои бизнесы
            </h2>
            <p className="text-sm text-slate-500">
              Заявки на владение — ждут проверки. Подтверждённые бизнесы — в
              меню слева.
            </p>
            <ul className="space-y-2">
              {self.pendingBusinessClaims.map((b) => (
                <li
                  className="flex flex-wrap items-center gap-2"
                  key={b.claimId}
                >
                  <Link
                    className="inline-flex min-h-11 items-center text-sm font-medium text-brand-blue hover:underline"
                    href={`/business/${b.slug}`}
                  >
                    {b.name}
                  </Link>
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">
                    На проверке
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

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
            <div className="space-y-2">
              <p className="text-sm text-slate-500">
                Специалист к аккаунту не привязан. Нужны имя и ZIP в настройках.
              </p>
              <Link
                className="inline-flex min-h-11 items-center text-sm font-medium text-brand-blue hover:underline"
                href="/professional/new"
              >
                Создать профиль специалиста
              </Link>
            </div>
          )}
        </section>

        <SkillFramesPanel
          editable
          frames={self.skillFrames}
          userId={profile.ownerId}
        />

        <ProfileActivitySections
          businesses={businesses}
          events={events}
          listings={listings}
          listingsAllHref="/me/listings"
          listingsTitle="Мои объявления"
          services={services}
          servicesAllHref="/me/services"
          servicesTitle="Мои услуги"
          showListingStatus
          showServiceStatus
        />
      </>
    ) : null;

  if (isSelf && self) {
    return (
      <div className="cabinet-wide mx-auto flex max-w-[1400px] flex-col gap-4 px-0 pb-20 md:flex-row md:items-start md:pb-0">
        <CabinetLeftNav active="profile" username={profile.username} />
        <div className="min-w-0 flex-1 space-y-6">{centerSelf}</div>
        <div className="min-w-0 w-full shrink-0 md:w-80 lg:w-96">
          <SearchFramesPanel frames={self.searchFrames} />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {headerCard}

      {!strangerPrivate && publicSkillFrames.length > 0 ? (
        <SkillFramesPanel editable={false} frames={publicSkillFrames} />
      ) : null}

      {!strangerPrivate ? (
        <ProfileActivitySections
          businesses={businesses}
          events={events}
          listings={profile.showListings ? listings : []}
          services={profile.showListings ? services : []}
        />
      ) : null}
    </div>
  );
}
