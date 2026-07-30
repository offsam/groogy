"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { MapPin, Star, CalendarCheck } from "lucide-react";
import {
  AdminLensBar,
  type AdminLensViewAs,
} from "@/components/admin/AdminLensBar";
import { AddProfessionalServiceButton } from "@/components/professional/AddProfessionalServiceButton";
import { BusinessMiniMap } from "@/components/business/profile/BusinessMiniMap";
import { formatProfessionalPrice, formatProfessionalDuration } from "@/lib/professional/mappers";
import { serviceTitleForDisplay } from "@/lib/professional/service-title-ru";
import { ProfessionalContactsCard } from "@/components/professional/ProfessionalContactsCard";
import { ProfessionalOriginBadges } from "@/components/professional/ProfessionalOriginBadges";
import { ProfessionalSourceCard } from "@/components/professional/ProfessionalSourceCard";
import { ProfessionalWorkplaceCard } from "@/components/professional/ProfessionalWorkplaceCard";
import { PaymentMethodsCard } from "@/components/shared/PaymentMethodsCard";
import { DescriptionWithOriginal } from "@/components/shared/DescriptionWithOriginal";
import { PromotionsSection } from "@/components/shared/PromotionCard";
import { UpdatesSection } from "@/components/shared/UpdateCard";
import { FollowEntityButton } from "@/components/shared/FollowEntityButton";
import type { Category } from "@/types/business";
import type { Professional, ProfessionalService } from "@/types/professional";
import type { EntityPromotion } from "@/types/promotion";
import type { EntityUpdate } from "@/types/update";

type ProfessionalProfileViewProps = {
  professional: Professional;
  services: ProfessionalService[];
  isOwner: boolean;
  currentUserId: string | null;
  /** Admin lens on live cards. */
  isAdmin?: boolean;
  categories?: Category[];
  /** Admin import preview: contacts visible, no owner chrome. */
  preview?: boolean;
  /** Source URLs for third-party recommendations (public click). */
  communitySourceUrls?: string[];
  /** Active акции — section hidden when empty. */
  promotions?: EntityPromotion[];
  /** Active новости — section hidden when empty. */
  updates?: EntityUpdate[];
  /** Whether the current user follows this profile. */
  initialFollowing?: boolean;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "К";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function hasPhoto(url: string | null | undefined): url is string {
  return Boolean(url && url !== "/placeholder.svg");
}

export function ProfessionalProfileView({
  professional,
  services,
  isOwner,
  currentUserId,
  isAdmin = false,
  categories = [],
  preview = false,
  communitySourceUrls = [],
  promotions = [],
  updates = [],
  initialFollowing = false,
}: ProfessionalProfileViewProps) {
  const [viewAs, setViewAs] = useState<AdminLensViewAs>("owner");

  const location = [
    professional.addressLine,
    professional.city,
    professional.region || professional.stateCode,
  ]
    .filter(Boolean)
    .join(", ");

  const mapLat =
    typeof professional.latitude === "number" &&
    Number.isFinite(professional.latitude)
      ? professional.latitude
      : null;
  const mapLng =
    typeof professional.longitude === "number" &&
    Number.isFinite(professional.longitude)
      ? professional.longitude
      : null;
  // Street address → exact pin; city / county → area map without a fake pin.
  const exactPin =
    professional.locationPrecision === "street" &&
    Boolean(professional.addressLine?.trim());
  const about =
    professional.shortDescription ||
    (professional.description &&
    professional.description !== professional.shortDescription
      ? professional.description
      : null);
  const longAbout =
    professional.description &&
    professional.description !== professional.shortDescription
      ? professional.description
      : null;

  const showOwnerChrome =
    !preview &&
    ((isOwner && !isAdmin) || (isAdmin && viewAs === "owner"));

  const photo = hasPhoto(professional.imageUrl)
    ? professional.imageUrl
    : null;

  const publicProfessional: Professional =
    isAdmin && !preview && viewAs === "visitor"
      ? {
          ...professional,
          phone: null,
          email: null,
          website: null,
          instagramUrl: null,
          telegramUrl: null,
          sourceUrl: null,
          // bookingUrl stays — public CTA like businesses
        }
      : professional;

  const bookHref = publicProfessional.bookingUrl?.trim() || null;

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-3 py-6 sm:px-6 sm:py-8">
      {isAdmin && !preview ? (
        <AdminLensBar
          categories={categories}
          kind="professional"
          professional={professional}
          viewAs={viewAs}
          onViewAsChange={setViewAs}
        />
      ) : null}

      {showOwnerChrome ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-blue/20 bg-brand-blue/5 px-3 py-2.5 text-sm">
          <span className="text-slate-700">
            {isAdmin ? "Вид владельца" : "Это ваш профиль специалиста"}
          </span>
          <Link
            className="font-semibold text-brand-blue"
            href={`/professional/${professional.slug}/edit`}
          >
            Редактировать
          </Link>
        </div>
      ) : null}

      {preview ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
          Предпросмотр публикации
        </p>
      ) : null}

      {isAdmin && !preview && viewAs === "visitor" ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
          Вид как у обычного пользователя — без кнопок владельца
        </p>
      ) : null}

      {/* Logo + identity — not a full-bleed hero (low-res photos stay as avatar). */}
      <header className="flex gap-3 sm:gap-4">
        <div className="relative size-20 shrink-0 overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-200/80 sm:size-24">
          {photo ? (
            <Image
              alt={professional.displayName}
              className="object-cover"
              fill
              priority
              sizes="96px"
              src={photo}
              unoptimized
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-gradient-to-br from-brand-blue/15 via-white to-brand-green/10">
              <span className="font-[family-name:var(--font-display)] text-xl font-semibold text-slate-400 sm:text-2xl">
                {initials(professional.displayName)}
              </span>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5 self-center">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            {professional.displayName}
          </h1>
          {professional.categoryName || professional.headline ? (
            <p className="text-sm text-slate-500">
              {professional.categoryName || professional.headline}
            </p>
          ) : null}
          {bookHref ? (
            <a
              className="mt-1 inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-brand-blue px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-blue/90"
              href={bookHref}
              rel="noopener noreferrer"
              target="_blank"
            >
              <CalendarCheck aria-hidden="true" className="size-3.5" />
              Записаться
            </a>
          ) : null}
          {!preview ? (
            <div className="pt-1">
              <FollowEntityButton
                initialFollowing={initialFollowing}
                isAuthenticated={Boolean(currentUserId)}
                ownerId={professional.id}
                ownerType="professional"
                revalidatePath={`/professional/${professional.slug}`}
              />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
            {professional.ratingAvg > 0 ? (
              <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
                <Star
                  aria-hidden="true"
                  className="size-3.5 fill-amber-500 text-amber-500"
                />
                {professional.ratingAvg.toFixed(1)}
                <span className="font-normal text-slate-500">
                  ({professional.reviewsCount})
                </span>
              </span>
            ) : null}
            {professional.experienceYears != null ? (
              <span>Опыт: {professional.experienceYears} лет</span>
            ) : null}
          </div>
          <ProfessionalOriginBadges
            professional={professional}
            sourceUrls={communitySourceUrls}
          />
        </div>
      </header>

      <ProfessionalWorkplaceCard professional={professional} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        {/* Phone: contacts under identity; lg+: contacts in right column */}
        <aside className="order-1 space-y-3 lg:order-2 lg:sticky lg:top-24">
          <ProfessionalContactsCard
            initiallyRevealed={Boolean(
              showOwnerChrome ||
                preview ||
                publicProfessional.phone ||
                publicProfessional.email ||
                publicProfessional.website ||
                publicProfessional.instagramUrl ||
                publicProfessional.telegramUrl,
            )}
            isAuthenticated={
              showOwnerChrome || preview ? true : Boolean(currentUserId)
            }
            professional={publicProfessional}
          />
          <PaymentMethodsCard methods={professional.paymentMethods} />

          {location || professional.serviceAreaText ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-900">Локация</h2>
              {location ? (
                <p className="mt-2 flex items-start gap-1.5 text-sm text-slate-700">
                  <MapPin
                    aria-hidden
                    className="mt-0.5 size-3.5 shrink-0 text-slate-400"
                  />
                  <span>{location}</span>
                </p>
              ) : null}
              {professional.serviceAreaText ? (
                <p className="mt-1.5 text-xs text-slate-500">
                  Зона: {professional.serviceAreaText}
                </p>
              ) : null}
              {mapLat != null && mapLng != null ? (
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
                  <BusinessMiniMap
                    lat={mapLat}
                    lng={mapLng}
                    showMarker={exactPin}
                    zoom={exactPin ? 14 : 11}
                  />
                </div>
              ) : null}
            </section>
          ) : null}

          <ProfessionalSourceCard
            initiallyRevealed={Boolean(
              showOwnerChrome ||
                preview ||
                publicProfessional.sourceUrl ||
                publicProfessional.sourceKind === "platform",
            )}
            isAuthenticated={
              showOwnerChrome || preview ? true : Boolean(currentUserId)
            }
            professional={publicProfessional}
          />
        </aside>

        <div className="order-2 space-y-4 lg:order-1">
          {about || longAbout ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <h2 className="text-base font-semibold text-slate-900">
                О специалисте
              </h2>
              {professional.shortDescription ? (
                <DescriptionWithOriginal
                  className="mt-3"
                  original={
                    longAbout ? null : professional.descriptionOriginal
                  }
                  text={professional.shortDescription}
                  textClassName="text-base leading-relaxed text-slate-800"
                />
              ) : null}
              {longAbout ? (
                <DescriptionWithOriginal
                  className="mt-3"
                  original={professional.descriptionOriginal}
                  text={longAbout}
                  textClassName="text-sm leading-relaxed text-slate-600"
                />
              ) : null}
            </section>
          ) : showOwnerChrome ? (
            <section className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-4 sm:p-5">
              <h2 className="text-base font-semibold text-slate-900">
                О специалисте
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                Добавьте короткое описание —{" "}
                <Link
                  className="font-semibold text-brand-blue"
                  href={`/professional/${professional.slug}/edit`}
                >
                  редактировать
                </Link>
              </p>
            </section>
          ) : null}

          <PromotionsSection promotions={promotions} />
          <UpdatesSection updates={updates} />

          {professional.availabilityText ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-900">
                Доступность
              </h2>
              <p className="mt-2 text-sm text-slate-700">
                {professional.availabilityText}
              </p>
            </section>
          ) : null}

          <section className="space-y-3" aria-label="Услуги">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">Услуги</h2>
              {showOwnerChrome ? (
                <AddProfessionalServiceButton
                  professionalId={professional.id}
                  slug={professional.slug}
                  variant="icon"
                />
              ) : null}
            </div>

            {services.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {services.map((s) => {
                  const title = serviceTitleForDisplay(s.title);
                  const durationLabel = formatProfessionalDuration(
                    s.durationMinutes,
                  );
                  return (
                  <article
                    key={s.id}
                    className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-sm"
                  >
                    <p className="font-semibold leading-snug text-slate-900">
                      {title.title}
                    </p>
                    {title.originalEn ? (
                      <p className="mt-0.5 text-xs text-slate-400">
                        {title.originalEn}
                      </p>
                    ) : null}
                    {s.description ? (
                      <p className="mt-1.5 line-clamp-3 flex-1 text-sm leading-relaxed text-slate-600">
                        {s.description}
                      </p>
                    ) : (
                      <div className="flex-1" />
                    )}
                    <p className="mt-3 text-sm font-semibold tabular-nums text-slate-900">
                      {durationLabel
                        ? `${formatProfessionalPrice(s)} · ${durationLabel}`
                        : formatProfessionalPrice(s)}
                    </p>
                  </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-500">
                Услуги пока не указаны
                {showOwnerChrome ? (
                  <span className="mt-2 block">
                    <AddProfessionalServiceButton
                      professionalId={professional.id}
                      slug={professional.slug}
                      variant="chip"
                    />
                  </span>
                ) : null}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
