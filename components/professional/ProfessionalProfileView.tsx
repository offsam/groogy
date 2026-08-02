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
import { ClaimProfessionalButton } from "@/components/professional/ClaimProfessionalButton";
import { BusinessMiniMap } from "@/components/business/profile/BusinessMiniMap";
import { formatProfessionalPrice } from "@/lib/professional/mappers";
import { ServiceListRow, ServiceTileRow } from "@/components/shared/ServiceListRow";
import { serviceTitleForDisplay } from "@/lib/professional/service-title-ru";
import { ProfessionalContactsCard } from "@/components/professional/ProfessionalContactsCard";
import { ProfessionalOriginBadges } from "@/components/professional/ProfessionalOriginBadges";
import { ProfessionalSourceCard } from "@/components/professional/ProfessionalSourceCard";
import { ProfessionalWorkplaceCard } from "@/components/professional/ProfessionalWorkplaceCard";
import { PaymentMethodsCard } from "@/components/shared/PaymentMethodsCard";
import { DescriptionWithOriginal } from "@/components/shared/DescriptionWithOriginal";
import { PromotionsSection } from "@/components/shared/PromotionCard";
import { UpdatesSection } from "@/components/shared/UpdateCard";
import {
  ExternalRatingChips,
  businessExternalRatingItems,
} from "@/components/shared/ExternalRatingsSection";
import { FollowEntityButton } from "@/components/shared/FollowEntityButton";
import { formatStructuredAddressLine } from "@/lib/address/normalize";
import { looksLikeStreetAddress } from "@/lib/business/location-precision";
import { redactContactsFromPublicText } from "@/lib/content/structure-business-profile";
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
  /** Open claim form after login redirect (`?claim=1`). */
  autoClaim?: boolean;
  /** Source URLs for third-party recommendations (public click). */
  communitySourceUrls?: string[];
  /** Active акции — section hidden when empty. */
  promotions?: EntityPromotion[];
  /** Active новости — section hidden when empty. */
  updates?: EntityUpdate[];
  /** Whether the current user follows this profile. */
  initialFollowing?: boolean;
  /** City-center fallback when there is no street pin (USA Location Canon). */
  cityMapCenter?: { lat: number; lng: number } | null;
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
  autoClaim = false,
  communitySourceUrls = [],
  promotions = [],
  updates = [],
  initialFollowing = false,
  cityMapCenter = null,
}: ProfessionalProfileViewProps) {
  const [viewAs, setViewAs] = useState<AdminLensViewAs>("visitor");

  const location = formatStructuredAddressLine({
    addressLine: professional.addressLine ?? null,
    city: professional.city,
    region: professional.region,
    stateCode: professional.stateCode,
    postalCode: professional.postalCode,
  });

  const hasEntityCoords =
    typeof professional.latitude === "number" &&
    Number.isFinite(professional.latitude) &&
    typeof professional.longitude === "number" &&
    Number.isFinite(professional.longitude);
  // Street pin only with real street coords; otherwise city-center map, no fake pin.
  const streetLine = professional.addressLine?.trim() || "";
  const exactPin =
    hasEntityCoords &&
    Boolean(streetLine) &&
    (professional.locationPrecision === "street" ||
      (professional.locationPrecision !== "county" &&
        professional.locationPrecision !== "city" &&
        looksLikeStreetAddress(streetLine)));
  const mapLat = exactPin
    ? professional.latitude
    : (cityMapCenter?.lat ?? (hasEntityCoords ? professional.latitude : null));
  const mapLng = exactPin
    ? professional.longitude
    : (cityMapCenter?.lng ?? (hasEntityCoords ? professional.longitude : null));
  const mapZoom = exactPin ? 14 : 11;
  // Always redact narrative on the public profile — even for admin/owner
  // payloads (mapProfessionalOwner keeps raw copy for the edit form).
  const shortAbout = redactContactsFromPublicText(
    professional.shortDescription,
  );
  const fullAbout = redactContactsFromPublicText(professional.description);
  const aboutOriginal = redactContactsFromPublicText(
    professional.descriptionOriginal,
  );
  const about =
    shortAbout ||
    (fullAbout && fullAbout !== shortAbout ? fullAbout : null);
  const longAbout =
    fullAbout && fullAbout !== shortAbout ? fullAbout : null;

  // Admin: raw DB copy still has contacts that guests never see.
  const dbNarrativeHidesContacts =
    Boolean(isAdmin) &&
    !preview &&
    [professional.shortDescription, professional.description].some((raw) => {
      const t = (raw || "").trim();
      if (!t) return false;
      return (redactContactsFromPublicText(t) || "").trim() !== t;
    });

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

      {dbNarrativeHidesContacts ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
          <p>
            В описании в базе ещё лежат контакты — пользователь их здесь не
            видит (только в «Контактах»). Чтобы убрать мусор из текста, откройте
            редактирование.
          </p>
          <Link
            className="mt-1 inline-flex min-h-11 items-center font-semibold text-brand-blue hover:underline"
            href={`/professional/${professional.slug}/edit`}
          >
            Редактировать описание
          </Link>
        </div>
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
      ) : !preview ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ClaimProfessionalButton
            autoSubmit={autoClaim}
            checkStatus
            professionalId={professional.id}
            professionalSlug={professional.slug}
          />
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
          <div className="space-y-1 text-sm text-slate-500">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
              ) : (
                <span>Пока нет отзывов</span>
              )}
              {professional.createdAt ? (
                <span className="text-xs text-slate-400">
                  На платформе с {new Date(professional.createdAt).getFullYear()}
                </span>
              ) : null}
            </div>
            <ExternalRatingChips
              items={businessExternalRatingItems({
                googleRating: professional.employerBusinessGoogleRating,
                googleReviewsCount:
                  professional.employerBusinessGoogleReviewsCount,
              })}
            />
          </div>
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
          <ProfessionalOriginBadges
            professional={professional}
            sourceUrls={communitySourceUrls}
          />
        </div>
      </header>

      <ProfessionalWorkplaceCard professional={professional} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        {/* Same as business sidebar: map/location first, then contacts. */}
        <aside className="order-1 space-y-3 lg:order-2 lg:sticky lg:top-24">
          {location || professional.serviceAreaText || (mapLat != null && mapLng != null) ? (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {mapLat != null && mapLng != null ? (
                <BusinessMiniMap
                  lat={mapLat}
                  lng={mapLng}
                  showMarker={exactPin}
                  zoom={exactPin ? 14 : 11}
                />
              ) : null}
              {location || professional.serviceAreaText ? (
                <div className="p-3">
                  {location ? (
                    <p className="flex items-start gap-1.5 text-sm text-slate-700">
                      <MapPin
                        aria-hidden
                        className="mt-0.5 size-3.5 shrink-0 text-brand-blue"
                      />
                      <span>{location}</span>
                    </p>
                  ) : null}
                  {professional.serviceAreaText ? (
                    <p className="mt-1.5 text-xs text-slate-500">
                      Зона: {professional.serviceAreaText}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

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
              {shortAbout ? (
                <DescriptionWithOriginal
                  heading="О специалисте"
                  original={longAbout ? null : aboutOriginal}
                  text={shortAbout}
                  textClassName="text-base leading-relaxed text-slate-800"
                />
              ) : null}
              {longAbout ? (
                <DescriptionWithOriginal
                  className={shortAbout ? "mt-3" : undefined}
                  heading={shortAbout ? undefined : "О специалисте"}
                  original={aboutOriginal}
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

          {services.length > 0 || showOwnerChrome ? (
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
              <ServiceTileRow>
                {services.map((s) => {
                  const title = serviceTitleForDisplay(s.title);
                  return (
                    <ServiceListRow
                      key={s.id}
                      price={formatProfessionalPrice(s)}
                      subtitle={title.originalEn || null}
                      title={title.title}
                    />
                  );
                })}
              </ServiceTileRow>
            ) : showOwnerChrome ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-500">
                Услуги пока не указаны
                <span className="mt-2 block">
                  <AddProfessionalServiceButton
                    professionalId={professional.id}
                    slug={professional.slug}
                    variant="chip"
                  />
                </span>
              </div>
            ) : null}
          </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
