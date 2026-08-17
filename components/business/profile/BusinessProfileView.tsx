"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  BadgeCheck,
  Briefcase,
  Calendar,
  MapPin,
  Percent,
  Plus,
  Sparkles,
  Star,
} from "lucide-react";
import { BusinessCard } from "@/components/business/BusinessCard";
import { AdminLensBar } from "@/components/admin/AdminLensBar";
import { ClaimBusinessButton } from "@/components/business/ClaimBusinessButton";
import { BusinessContactsCard } from "@/components/business/profile/BusinessContactsCard";
import { BusinessGallery } from "@/components/business/profile/BusinessGallery";
import { BusinessHeaderActions } from "@/components/business/profile/BusinessHeaderActions";
import { BusinessMiniMap } from "@/components/business/profile/BusinessMiniMap";
import { BusinessProfileSidebar } from "@/components/business/profile/BusinessProfileSidebar";
import { EventCard } from "@/components/events/EventCard";
import { PaymentMethodsCard } from "@/components/shared/PaymentMethodsCard";
import { DescriptionWithOriginal } from "@/components/shared/DescriptionWithOriginal";
import {
  PromotionCard,
} from "@/components/shared/PromotionCard";
import { UpdatesSection } from "@/components/shared/UpdateCard";
import { FollowEntityButton } from "@/components/shared/FollowEntityButton";
import { BusinessProfileTabs } from "@/components/business/profile/BusinessProfileTabs";
import { EditModeBanner } from "@/components/business/profile/edit/EditModeBanner";
import { EditPencil } from "@/components/business/profile/edit/EditPencil";
import { EditPhotoDialog } from "@/components/business/profile/edit/EditPhotoDialog";
import {
  EditAddressDialog,
  EditContactsDialog,
  EditCopyDialog,
  EditHoursDialog,
} from "@/components/business/profile/edit/SectionEditors";
import type { ProfileTab } from "@/lib/business/profile-tabs";
import { BusinessOffersSection } from "@/components/business-offers/BusinessOffersSection";
import { BusinessCommunityMentions } from "@/components/business/profile/BusinessCommunityMentions";
import { BusinessReviewsSection } from "@/components/reviews/BusinessReviewsSection";
import {
  ExternalRatingChips,
  businessExternalRatingItems,
} from "@/components/shared/ExternalRatingsSection";
import {
  formatOfficesDescriptionLine,
  pickBusinessLocationsForHubs,
} from "@/lib/business/location-for-hub";
import type { PlatformEvent } from "@/lib/events/queries";
import type { RegionHub } from "@/lib/regions/hubs";
import { structureBusinessProfileCopy } from "@/lib/content/structure-business-profile";
import { hasRealBusinessPhoto } from "@/lib/business/media";
import { formatOfferPrice, offerCoverUrl } from "@/lib/business-offers/mappers";
import { isRestaurantsCategory } from "@/lib/business-offers/food-category";
import { ServiceListRow, ServiceTileRow } from "@/components/shared/ServiceListRow";
import { formatAddress } from "@/lib/supabase/mappers";
import { looksLikeStreetAddress } from "@/lib/business/location-precision";
import { BusinessJobsPanel } from "@/components/business/profile/BusinessJobsPanel";
import { BusinessEmployeesSection } from "@/components/business/profile/BusinessEmployeesSection";
import type { Job } from "@/types/job";
import type { BusinessEmployeeTeaser } from "@/lib/business/employees";
import type { Business, Category } from "@/types/business";
import type { BusinessOffer } from "@/types/business-offer";
import type { CommunityMention } from "@/types/community-mention";
import {
  formatBusinessLocationLine,
  type BusinessLocation,
} from "@/types/business-location";
import type { Review, ReviewVerificationSession } from "@/types/review";
import type { EntityPromotion } from "@/types/promotion";
import type { EntityUpdate } from "@/types/update";

type EditSection =
  | "photo"
  | "hours"
  | "address"
  | "contacts"
  | "about"
  | "jobs"
  | "promotions"
  | null;

type BusinessProfileViewProps = {
  business: Business;
  /** City center for an area map when no exact street address is available. */
  cityMapCenter?: { lat: number; lng: number } | null;
  businessSlug: string;
  offers: BusinessOffer[];
  jobs: Job[];
  /** Professionals with employer_business_id → this business. */
  employees?: BusinessEmployeeTeaser[];
  reviews: Review[];
  /** Events hosted / provided by this business. */
  events?: PlatformEvent[];
  communityMentions?: CommunityMention[];
  locations?: BusinessLocation[];
  /** Active region hubs from header filter / cookie. */
  activeHubs?: RegionHub[];
  similar: Business[];
  isOwner: boolean;
  isAdmin?: boolean;
  /** Confirmed owner exists — nested offers cannot be claimed separately. */
  businessAlreadyClaimed?: boolean;
  /** Active business categories — only needed for admin category picker. */
  categories?: Category[];
  autoClaim: boolean;
  currentUserId: string | null;
  myReview: Review | null;
  mySession: ReviewVerificationSession | null;
  activeTab?: string | null;
  editMode?: boolean;
  /** Admin import preview: public layout, contacts visible, no claim/edit chrome. */
  preview?: boolean;
  /**
   * Queue/import preview: amber admin strip in the same place as live AdminLensBar
   * (Опубликовать + enrich). When set, shown even while `preview` is true.
   */
  adminChrome?: ReactNode;
  /** Card-based акции; when present they replace the legacy text block. */
  promotions?: EntityPromotion[];
  /** Profile news — section hidden when empty. */
  updates?: EntityUpdate[];
  initialFollowing?: boolean;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "К";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function collectGallery(business: Business, offers: BusinessOffer[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (url: string | null | undefined) => {
    if (!url || !hasRealBusinessPhoto(url) || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  push(business.imageUrl);
  for (const url of business.galleryUrls ?? []) push(url);
  for (const offer of offers) {
    push(offerCoverUrl(offer));
    for (const media of offer.media ?? []) push(media.publicUrl);
  }
  return out;
}

function platformSinceLabel(createdAt?: string | null) {
  if (!createdAt) return null;
  const year = new Date(createdAt).getFullYear();
  if (!Number.isFinite(year)) return null;
  return `На платформе с ${year}`;
}

export function BusinessProfileView({
  business,
  cityMapCenter = null,
  businessSlug,
  offers,
  jobs,
  employees = [],
  reviews,
  events = [],
  communityMentions = [],
  locations = [],
  activeHubs = [],
  similar,
  isOwner,
  isAdmin = false,
  businessAlreadyClaimed = false,
  categories = [],
  autoClaim,
  currentUserId,
  myReview,
  mySession,
  activeTab: activeTabProp,
  editMode = false,
  preview = false,
  adminChrome = null,
  promotions = [],
  updates = [],
  initialFollowing = false,
}: BusinessProfileViewProps) {
  const [editSection, setEditSection] = useState<EditSection>(null);
  const canInlineEdit = isOwner && editMode && !preview;
  const sidebarLocations = canInlineEdit
    ? locations
    : pickBusinessLocationsForHubs(locations, activeHubs);
  const hubLocation = sidebarLocations[0] ?? null;
  const address = hubLocation
    ? hubLocation.addressLine?.trim()
      ? formatBusinessLocationLine(hubLocation)
      : formatAddress({
          ...business,
          city: hubLocation.city ?? business.city,
          region: hubLocation.region ?? business.region,
        }) || formatBusinessLocationLine(hubLocation)
    : formatAddress(business);
  const addressLine = address;
  const locationLines =
    sidebarLocations.length > 0
      ? sidebarLocations.map((loc) => ({
          id: loc.id,
          label: loc.label?.trim() || null,
          line: loc.addressLine?.trim()
            ? formatBusinessLocationLine(loc)
            : formatAddress({
                ...business,
                city: loc.city ?? business.city,
                region: loc.region ?? business.region,
              }) || formatBusinessLocationLine(loc),
        }))
      : addressLine
        ? [{ id: "primary", label: null as string | null, line: addressLine }]
        : [];
  const locationLat =
    typeof hubLocation?.latitude === "number" &&
    Number.isFinite(hubLocation.latitude)
      ? hubLocation.latitude
      : business.latitude;
  const locationLng =
    typeof hubLocation?.longitude === "number" &&
    Number.isFinite(hubLocation.longitude)
      ? hubLocation.longitude
      : business.longitude;
  const hasLocationCoords =
    typeof locationLat === "number" &&
    Number.isFinite(locationLat) &&
    typeof locationLng === "number" &&
    Number.isFinite(locationLng);
  // Pin only with real coords. Prefer location_precision=street; also accept
  // street-looking address + coords when precision was never stamped.
  const mapAddressLine =
    hubLocation?.addressLine?.trim() || business.addressLine?.trim() || "";
  const locationPrecision =
    hubLocation?.locationPrecision ?? business.locationPrecision;
  const preciseAddress =
    hasLocationCoords &&
    Boolean(mapAddressLine) &&
    (locationPrecision === "street" ||
      (locationPrecision !== "county" &&
        looksLikeStreetAddress(mapAddressLine)));
  const mapLat = preciseAddress
    ? locationLat
    : (cityMapCenter?.lat ?? locationLat);
  const mapLng = preciseAddress
    ? locationLng
    : (cityMapCenter?.lng ?? locationLng);
  const showBottomMap =
    typeof mapLat === "number" &&
    Number.isFinite(mapLat) &&
    typeof mapLng === "number" &&
    Number.isFinite(mapLng);
  const mapZoom = preciseAddress ? 14 : 11;
  const mapsUrl = hubLocation
    ? hubLocation.googleMapsUrl ||
      (addressLine
        ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addressLine)}`
        : null)
    : addressLine
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addressLine)}`
      : typeof business.latitude === "number" &&
          typeof business.longitude === "number"
        ? `https://www.google.com/maps/dir/?api=1&destination=${business.latitude},${business.longitude}`
        : null;
  const gallery = collectGallery(business, offers);
  const featuredOffers = [...offers]
    .sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured))
    .slice(0, 6);
  const previewReview = reviews[0] ?? null;
  const previewMention = communityMentions[0] ?? null;
  const since = platformSinceLabel(business.createdAt);
  const showVerified =
    business.aiVerifiedReviewsCount > 0 ||
    business.transactionVerifiedReviewsCount > 0;

  const copy = structureBusinessProfileCopy(
    business.description,
    business.shortDescription,
  );
  const officesLine = formatOfficesDescriptionLine(locations);
  const aboutText = [copy.about, officesLine].filter(Boolean).join("\n\n") || null;
  const aboutPreviewText =
    [copy.aboutPreview, officesLine].filter(Boolean).join("\n\n") || null;
  // Contacts (incl. extracted from copy) only for owners in edit mode —
  // except admin import `preview`, where we show what will publish.
  // Everyone else reveals via /api/business/[slug]/contacts after auth.
  const revealContactsInline = canInlineEdit || preview;
  const actionEmail = revealContactsInline
    ? business.email || copy.extractedEmails[0] || null
    : null;

  const promotionsCount =
    promotions.length > 0 ? promotions.length : copy.promotions ? 1 : 0;
  const jobsCount = jobs.length > 0 ? jobs.length : copy.jobs ? 1 : 0;
  const reviewsCount = business.reviewsCount || reviews.length;
  const externalRatings = businessExternalRatingItems({
    googleRating: business.googleRating,
    googleReviewsCount: business.googleReviewsCount,
    googleMapsUrl: business.googleMapsUrl,
    yelpRating: business.yelpRating,
    yelpReviewsCount: business.yelpReviewsCount,
    yelpUrl: business.yelpUrl,
    trustpilotRating: business.trustpilotRating,
    trustpilotReviewsCount: business.trustpilotReviewsCount,
    trustpilotUrl: business.trustpilotUrl,
  });

  const offersTabLabel = isRestaurantsCategory(business.categorySlug)
    ? "Меню"
    : "Услуги";

  const tabs: ProfileTab[] = [
    { id: "overview", label: "Обзор" },
    { id: "services", label: offersTabLabel, count: offers.length },
    ...(employees.length > 0
      ? [{ id: "team", label: "Сотрудники", count: employees.length }]
      : []),
    { id: "jobs", label: "Вакансии", count: jobsCount },
    { id: "promotions", label: "Акции", count: promotionsCount },
    { id: "events", label: "События", count: events.length },
    { id: "reviews", label: "Отзывы", count: reviewsCount },
    ...(gallery.length > 0 || canInlineEdit
      ? [{ id: "photos", label: "Фото", count: gallery.length }]
      : []),
  ];
  const tabIds = new Set(tabs.map((t) => t.id));
  const activeTab =
    activeTabProp && tabIds.has(activeTabProp) ? activeTabProp : "overview";
  const editHref = activeTabProp
    ? `/business/${businessSlug}?edit=1&tab=${encodeURIComponent(activeTabProp)}`
    : `/business/${businessSlug}?edit=1`;

  const presenceForReveal = revealContactsInline
    ? {
        website: business.website || copy.extractedWebsiteUrls[0] || null,
        instagramUrl:
          business.instagramUrl || copy.extractedInstagramUrls[0] || null,
        telegramUrl: business.telegramUrl,
        sourceUrl: business.sourceUrl,
        sourceKind: business.sourceKind,
        facebookUrl: business.facebookUrl || copy.extractedFacebookUrls[0] || null,
        tiktokUrl: business.tiktokUrl,
        yelpUrl: business.yelpUrl,
        bookingUrl: business.bookingUrl,
        contactLinks: business.contactLinks,
        googleMapsUrl: hubLocation?.googleMapsUrl || business.googleMapsUrl,
        googleRating: business.googleRating,
        googleReviewsCount: business.googleReviewsCount,
        latitude: hubLocation?.latitude ?? business.latitude,
        longitude: hubLocation?.longitude ?? business.longitude,
      }
    : {
        website: null,
        instagramUrl: null,
        telegramUrl: null,
        sourceUrl: null,
        sourceKind: null,
        facebookUrl: null,
        tiktokUrl: null,
        yelpUrl: null,
        bookingUrl: business.bookingUrl,
        contactLinks: [],
        googleMapsUrl: null,
        googleRating: business.googleRating,
        googleReviewsCount: business.googleReviewsCount,
        latitude: hubLocation?.latitude ?? business.latitude,
        longitude: hubLocation?.longitude ?? business.longitude,
      };

  return (
    <article
      className={
        preview
          ? "business-profile mx-0 min-w-0 space-y-3 overflow-x-hidden pb-4 sm:space-y-5 sm:pb-10"
          : "business-profile -mx-4 space-y-4 pb-10 sm:mx-0 sm:space-y-5"
      }
    >
      {canInlineEdit ? (
        <div className="px-4 sm:px-0">
          <EditModeBanner activeTab={activeTabProp} businessSlug={businessSlug} />
        </div>
      ) : null}

      {!preview ? (
      <nav
        aria-label="Хлебные крошки"
        className="flex items-center gap-1.5 overflow-x-auto px-4 text-xs text-slate-500 [scrollbar-width:none] sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        <Link className="shrink-0 hover:text-slate-800" href="/">
          Главная
        </Link>
        <span aria-hidden="true">›</span>
        <Link className="shrink-0 hover:text-slate-800" href="/search">
          Бизнесы
        </Link>
        {business.categoryName ? (
          <>
            <span aria-hidden="true">›</span>
            <Link
              className="shrink-0 hover:text-slate-800"
              href={
                business.categorySlug
                  ? `/search?category=${business.categorySlug}`
                  : "/search"
              }
            >
              {business.categoryName}
            </Link>
          </>
        ) : null}
        <span aria-hidden="true">›</span>
        <span className="shrink-0 truncate font-medium text-slate-700">
          {business.name}
        </span>
      </nav>
      ) : null}

      {adminChrome ? (
        <div className="px-4 sm:px-0">{adminChrome}</div>
      ) : isAdmin && !preview ? (
        <div className="px-4 sm:px-0">
          <AdminLensBar
            business={business}
            categories={categories}
            kind="business"
            showDelete={!editMode}
          />
        </div>
      ) : null}

      <div className="relative">
        <BusinessGallery
          flush={preview}
          images={gallery}
          name={business.name}
        />
        {canInlineEdit ? (
          <div className="absolute right-3 top-3 z-10 sm:right-4 sm:top-4">
            <EditPencil
              label="Изменить фото"
              onClick={() => setEditSection("photo")}
            />
          </div>
        ) : null}
      </div>

      <div className="space-y-4 px-4 sm:px-0">
        <header className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <div
              aria-hidden="true"
              className="hidden size-16 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-lg font-bold tracking-tight text-white sm:flex"
              style={{ color: "#ffffff" }}
            >
              {initials(business.name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                  {business.name}
                </h1>
                {showVerified ? (
                  <BadgeCheck
                    aria-label="Подтверждён"
                    className="size-5 shrink-0 text-brand-green"
                  />
                ) : null}
              </div>

              <div className="mt-2 space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {business.reviewsCount > 0 ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
                      <Star
                        aria-hidden="true"
                        className="size-3.5 fill-amber-500 text-amber-500"
                      />
                      {business.ratingAvg.toFixed(1)}
                      <span className="font-normal text-slate-500">
                        ({business.reviewsCount})
                      </span>
                    </span>
                  ) : (
                    <span className="text-slate-500">Пока нет отзывов</span>
                  )}
                  {since ? (
                    <span className="text-xs text-slate-400">{since}</span>
                  ) : null}
                  {business.aiVerifiedReviewsCount > 0 ? (
                    <span className="inline-flex items-center gap-1 text-slate-600">
                      <Sparkles aria-hidden="true" className="size-3.5 text-sky-500" />
                      {business.aiVerifiedReviewsCount} AI
                    </span>
                  ) : null}
                  {business.transactionVerifiedReviewsCount > 0 ? (
                    <span className="inline-flex items-center gap-1 text-slate-600">
                      <BadgeCheck aria-hidden="true" className="size-3.5 text-emerald-600" />
                      {business.transactionVerifiedReviewsCount} подтвержд.
                    </span>
                  ) : null}
                </div>
                <ExternalRatingChips items={externalRatings} />
              </div>
            </div>
            <BusinessHeaderActions
              bookingUrl={business.bookingUrl}
              businessName={business.name}
              className="w-full sm:w-auto"
              email={actionEmail}
              followAction={
                !preview ? (
                  <FollowEntityButton
                    className="min-h-11 rounded-xl px-3 py-2.5 sm:min-h-0 sm:rounded-lg sm:py-1.5"
                    initialFollowing={initialFollowing}
                    isAuthenticated={Boolean(currentUserId)}
                    ownerId={business.id}
                    ownerType="business"
                    revalidatePath={`/business/${businessSlug}`}
                  />
                ) : null
              }
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {preview ? (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                Предпросмотр публикации
              </span>
            ) : isOwner ? (
              <>
                <Link
                  className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  href={`/business/${businessSlug}/manage`}
                >
                  Управление
                </Link>
                {editMode ? (
                  <Link
                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    href={`/business/${businessSlug}`}
                    scroll={false}
                  >
                    Готово
                  </Link>
                ) : (
                  <Link
                    className="rounded-full border border-brand-blue/30 bg-brand-blue/5 px-2.5 py-1 text-xs font-medium text-brand-blue-deep hover:bg-brand-blue/10"
                    href={editHref}
                    scroll={false}
                  >
                    Редактировать
                  </Link>
                )}
              </>
            ) : (
              <ClaimBusinessButton
                autoSubmit={autoClaim}
                businessId={business.id}
                businessSlug={businessSlug}
                checkStatus
                kind="business"
              />
            )}
          </div>
        </header>

        <BusinessProfileTabs
          activeTab={activeTab}
          businessSlug={businessSlug}
          editMode={canInlineEdit}
          tabs={tabs}
        />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17.5rem] lg:items-start">
          <div className="order-1 space-y-5 lg:order-1">
            {activeTab === "overview" ? (
              <section className="space-y-5" aria-label="Обзор">
                {aboutPreviewText || canInlineEdit ? (
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      {aboutText ? (
                        <DescriptionWithOriginal
                          className="min-w-0 flex-1"
                          heading="О нас"
                          original={business.descriptionOriginal}
                          text={aboutText}
                          textClassName="text-sm leading-relaxed text-slate-600"
                        />
                      ) : (
                        <p className="text-sm text-slate-500">
                          Добавьте описание компании
                        </p>
                      )}
                      <div className="flex shrink-0 items-center gap-2">
                        {canInlineEdit ? (
                          <EditPencil
                            label="Редактировать описание"
                            onClick={() => setEditSection("about")}
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                {featuredOffers.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-end justify-between gap-2 px-0.5">
                      <h2 className="text-base font-semibold text-slate-900">
                        {offersTabLabel}
                      </h2>
                      <div className="flex items-center gap-2">
                        {canInlineEdit ? (
                          <Link
                            className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline"
                            href={`/business/${businessSlug}/manage`}
                          >
                            <Plus aria-hidden="true" className="size-3.5" />
                            Добавить
                          </Link>
                        ) : null}
                        <Link
                          className="text-sm font-medium text-brand-blue hover:underline"
                          href={`/business/${businessSlug}?tab=services`}
                          scroll={false}
                        >
                          Все
                        </Link>
                      </div>
                    </div>
                    <ServiceTileRow>
                      {featuredOffers.map((offer) => (
                        <ServiceListRow
                          key={offer.id}
                          href={`/business/${businessSlug}/offers/${offer.slug}`}
                          price={formatOfferPrice(offer)}
                          title={offer.title}
                        />
                      ))}
                    </ServiceTileRow>
                  </div>
                ) : null}

                {/* Phone: contacts in main flow. Desktop/tablet: right column. */}
                <div className="lg:hidden">
                  <BusinessContactsCard
                    businessId={business.id}
                    businessName={business.name}
                    businessSlug={businessSlug}
                    editMode={canInlineEdit}
                    email={revealContactsInline ? business.email : null}
                    extraPhones={revealContactsInline ? copy.extractedPhones : []}
                    fallbackEmail={
                      revealContactsInline
                        ? (copy.extractedEmails[0] ?? null)
                        : null
                    }
                    initiallyRevealed={canInlineEdit || preview}
                    isAuthenticated={Boolean(currentUserId) || preview}
                    phone={revealContactsInline ? business.phone : null}
                    presence={presenceForReveal}
                    presenceFlags={business.presenceFlags}
                    routeUrl={revealContactsInline ? mapsUrl : null}
                    onEdit={() => setEditSection("contacts")}
                  />
                </div>

                {promotions.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="inline-flex items-center gap-1.5 text-base font-semibold text-slate-900">
                        <Percent aria-hidden="true" className="size-4 text-rose-600" />
                        Акции
                      </h2>
                      <Link
                        className="text-sm font-medium text-brand-blue hover:underline"
                        href={`/business/${businessSlug}?tab=promotions`}
                        scroll={false}
                      >
                        Все
                      </Link>
                    </div>
                    <PromotionCard promo={promotions[0]!} />
                  </div>
                ) : copy.promotions ? (
                  <div className="rounded-2xl border border-rose-200/80 bg-rose-50/50 p-4 sm:p-5">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="inline-flex items-center gap-1.5 text-base font-semibold text-slate-900">
                        <Percent aria-hidden="true" className="size-4 text-rose-600" />
                        Акции
                      </h2>
                      <div className="flex items-center gap-2">
                        {canInlineEdit ? (
                          <EditPencil
                            label="Редактировать акции"
                            onClick={() => setEditSection("promotions")}
                          />
                        ) : null}
                        <Link
                          className="text-sm font-medium text-brand-blue hover:underline"
                          href={`/business/${businessSlug}?tab=promotions`}
                          scroll={false}
                        >
                          Все
                        </Link>
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {copy.promotions}
                    </p>
                  </div>
                ) : null}

                <UpdatesSection updates={updates} />

                {employees.length > 0 ? (
                  <BusinessEmployeesSection employees={employees} />
                ) : null}

                {previewReview ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-base font-semibold text-slate-900">Отзывы</h2>
                      <Link
                        className="text-sm font-medium text-brand-blue hover:underline"
                        href={`/business/${businessSlug}?tab=reviews`}
                        scroll={false}
                      >
                        Все ({business.reviewsCount})
                      </Link>
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center gap-2">
                        <div
                          aria-hidden="true"
                          className="flex size-9 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600"
                        >
                          {(previewReview.authorDisplayName ?? "К").slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">
                            {previewReview.authorDisplayName ?? "Пользователь"}
                          </p>
                          <div className="flex items-center gap-0.5">
                            {Array.from({ length: 5 }, (_, i) => (
                              <Star
                                key={i}
                                aria-hidden="true"
                                className={`size-3 ${
                                  i < previewReview.rating
                                    ? "fill-amber-500 text-amber-500"
                                    : "text-slate-300"
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                      <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-slate-600">
                        {previewReview.body}
                      </p>
                    </div>
                  </div>
                ) : null}

                {previewMention ||
                (business.thirdPartyMentionCount ?? 0) > 0 ? (
                  <BusinessCommunityMentions
                    compact
                    mode={isAdmin ? "admin" : "public"}
                    mentions={communityMentions}
                    selfAdCount={business.selfAdMentionCount}
                    thirdPartyCount={
                      business.thirdPartyMentionCount ?? communityMentions.length
                    }
                  />
                ) : null}

                {similar.length > 0 ? (
                  <section className="space-y-3">
                    <h2 className="text-base font-semibold text-slate-900">Похожие бизнесы</h2>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {similar.map((item) => (
                        <BusinessCard key={item.id} business={item} />
                      ))}
                    </div>
                  </section>
                ) : null}
              </section>
            ) : null}

            {activeTab === "services" ? (
              <section aria-label={offersTabLabel} className="space-y-3">
                {canInlineEdit ? (
                  <div className="flex justify-end">
                    <Link
                      className="inline-flex items-center gap-1.5 rounded-xl border border-brand-blue/30 bg-brand-blue/5 px-3 py-1.5 text-sm font-medium text-brand-blue-deep hover:bg-brand-blue/10"
                      href={`/business/${businessSlug}/manage`}
                    >
                      <Plus aria-hidden="true" className="size-3.5" />
                      {offersTabLabel === "Меню"
                        ? "Управление меню"
                        : "Управление услугами"}
                    </Link>
                  </div>
                ) : null}
                {offers.length > 0 ? (
                  <BusinessOffersSection
                    businessAlreadyClaimed={businessAlreadyClaimed || isOwner}
                    businessSlug={businessSlug}
                    groupMenuBySection={offersTabLabel === "Меню"}
                    offers={offers}
                    presence={presenceForReveal}
                    sectionLabel={
                      offersTabLabel === "Меню" ? "Меню" : null
                    }
                  />
                ) : (
                  <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
                    {offersTabLabel === "Меню"
                      ? "Меню пока нет."
                      : "Услуг пока нет."}
                  </p>
                )}
              </section>
            ) : null}

            {activeTab === "team" ? (
              <section aria-label="Сотрудники" className="space-y-3">
                <BusinessEmployeesSection employees={employees} />
              </section>
            ) : null}

            {activeTab === "jobs" ? (
              <section className="space-y-3" aria-label="Вакансии">
                <h2 className="inline-flex items-center gap-1.5 text-base font-semibold text-slate-900">
                  <Briefcase aria-hidden="true" className="size-4 text-amber-700" />
                  Вакансии
                </h2>
                {jobs.length > 0 || copy.jobs || isOwner ? (
                  <div className="rounded-2xl border border-amber-200/80 bg-amber-50/40 p-4 sm:p-5">
                    <BusinessJobsPanel
                      businessId={business.id}
                      businessSlug={businessSlug}
                      canEdit={isOwner}
                      city={business.city}
                      jobs={jobs}
                    />
                    {jobs.length === 0 && copy.jobs ? (
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                        {copy.jobs}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
                    Вакансий пока нет.
                  </p>
                )}
              </section>
            ) : null}

            {activeTab === "promotions" ? (
              <section className="space-y-3" aria-label="Акции">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="inline-flex items-center gap-1.5 text-base font-semibold text-slate-900">
                    <Percent aria-hidden="true" className="size-4 text-rose-600" />
                    Акции
                  </h2>
                  {canInlineEdit && promotions.length === 0 ? (
                    <EditPencil
                      label="Редактировать акции"
                      onClick={() => setEditSection("promotions")}
                    />
                  ) : null}
                </div>
                {promotions.length > 0 ? (
                  <div className="space-y-3">
                    {promotions.map((promo) => (
                      <PromotionCard key={promo.id} promo={promo} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-rose-200/80 bg-rose-50/40 p-4 sm:p-5">
                    {copy.promotions ? (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                        {copy.promotions}
                      </p>
                    ) : (
                      <p className="text-sm text-slate-500">Акций пока нет</p>
                    )}
                  </div>
                )}
              </section>
            ) : null}

            {activeTab === "events" ? (
              <section className="space-y-3" aria-label="События">
                <h2 className="inline-flex items-center gap-1.5 text-base font-semibold text-slate-900">
                  <Calendar aria-hidden="true" className="size-4 text-brand-blue" />
                  События
                </h2>
                {events.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {events.map((event) => (
                      <EventCard key={event.id} event={event} />
                    ))}
                  </div>
                ) : (
                  <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
                    Событий пока нет.
                  </p>
                )}
              </section>
            ) : null}

            {activeTab === "reviews" ? (
              <section aria-label="Отзывы" className="space-y-4">
                {communityMentions.length > 0 ||
                (business.thirdPartyMentionCount ?? 0) > 0 ||
                isAdmin ? (
                  <BusinessCommunityMentions
                    mode={isAdmin ? "admin" : "public"}
                    mentions={communityMentions}
                    selfAdCount={business.selfAdMentionCount}
                    thirdPartyCount={
                      business.thirdPartyMentionCount ?? communityMentions.length
                    }
                  />
                ) : null}
                <BusinessReviewsSection
                  aiVerifiedCount={business.aiVerifiedReviewsCount}
                  businessId={business.id}
                  businessSlug={business.slug}
                  currentUserId={currentUserId}
                  isOwner={isOwner}
                  myReview={myReview}
                  mySession={mySession}
                  preview={preview}
                  ratingAvg={business.ratingAvg}
                  reviews={reviews}
                  reviewsCount={business.reviewsCount}
                  transactionVerifiedCount={business.transactionVerifiedReviewsCount}
                />
              </section>
            ) : null}

            {activeTab === "photos" && (gallery.length > 0 || canInlineEdit) ? (
              <section className="space-y-3" aria-label="Фото">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-slate-900">Фото</h2>
                  {canInlineEdit ? (
                    <EditPencil
                      label="Изменить фото"
                      onClick={() => setEditSection("photo")}
                    />
                  ) : null}
                </div>
                {gallery.length > 0 ? (
                  <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-2 sm:overflow-visible sm:px-0 md:grid-cols-5 [&::-webkit-scrollbar]:hidden">
                    {gallery.slice(0, 10).map((url, i) => (
                      <div
                        key={`${url}-${i}`}
                        className="relative aspect-square w-24 shrink-0 overflow-hidden rounded-xl bg-slate-100 sm:w-auto"
                      >
                        <Image
                          alt=""
                          className="object-cover"
                          fill
                          sizes="(max-width: 640px) 96px, 20vw"
                          src={url}
                          unoptimized
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
                    Фото ещё нет — добавьте обложку
                  </p>
                )}
              </section>
            ) : null}
          </div>

          <aside className="order-2 space-y-3 lg:sticky lg:top-24">
            {/* Desktop/tablet right column: map on top, then contacts */}
            {showBottomMap || locationLines.length > 0 || canInlineEdit ? (
              <div className="relative hidden overflow-hidden rounded-2xl border border-slate-200 lg:block">
                {canInlineEdit ? (
                  <div className="absolute right-3 top-3 z-10">
                    <EditPencil
                      label={
                        locationLines.length > 0
                          ? "Редактировать адрес"
                          : "Добавить адрес"
                      }
                      onClick={() => setEditSection("address")}
                    />
                  </div>
                ) : null}
                {showBottomMap ? (
                  <BusinessMiniMap
                    lat={mapLat!}
                    lng={mapLng!}
                    showMarker={preciseAddress}
                    zoom={mapZoom}
                  />
                ) : null}
                {locationLines.length > 0 ? (
                  <ul className="divide-y divide-slate-200">
                    {locationLines.map((loc) => (
                      <li
                        key={loc.id}
                        className="flex items-start gap-2 px-3 py-3 text-sm text-slate-700"
                      >
                        <MapPin
                          aria-hidden="true"
                          className="mt-0.5 size-4 shrink-0 text-brand-blue"
                        />
                        <span className="min-w-0">
                          {loc.label ? (
                            <span className="mb-0.5 block font-medium text-slate-900">
                              {loc.label}
                            </span>
                          ) : null}
                          {loc.line}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : canInlineEdit ? (
                  <p className="px-3 py-3 pr-12 text-sm text-slate-500">
                    Адрес ещё не указан
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="hidden lg:block">
              <BusinessContactsCard
                businessId={business.id}
                businessName={business.name}
                businessSlug={businessSlug}
                editMode={canInlineEdit}
                email={revealContactsInline ? business.email : null}
                extraPhones={revealContactsInline ? copy.extractedPhones : []}
                fallbackEmail={
                  revealContactsInline
                    ? (copy.extractedEmails[0] ?? null)
                    : null
                }
                initiallyRevealed={canInlineEdit || preview}
                isAuthenticated={Boolean(currentUserId) || preview}
                phone={revealContactsInline ? business.phone : null}
                presence={presenceForReveal}
                presenceFlags={business.presenceFlags}
                routeUrl={revealContactsInline ? mapsUrl : null}
                onEdit={() => setEditSection("contacts")}
              />
            </div>
            <PaymentMethodsCard methods={business.paymentMethods} />
            <BusinessProfileSidebar
              business={business}
              businessSlug={businessSlug}
              editMode={canInlineEdit}
              initiallyRevealed={canInlineEdit || preview}
              isAuthenticated={Boolean(currentUserId) || preview}
              presence={presenceForReveal}
              onEditHours={() => setEditSection("hours")}
            />
          </aside>
        </div>

        {showBottomMap || locationLines.length > 0 || canInlineEdit ? (
          <section aria-label="На карте" className="space-y-3 lg:hidden">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">На карте</h2>
              {canInlineEdit ? (
                <EditPencil
                  label={
                    locationLines.length > 0
                      ? "Редактировать адрес"
                      : "Добавить адрес"
                  }
                  onClick={() => setEditSection("address")}
                />
              ) : null}
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              {showBottomMap ? (
                <BusinessMiniMap
                  lat={mapLat!}
                  lng={mapLng!}
                  showMarker={preciseAddress}
                  zoom={mapZoom}
                />
              ) : null}
              {locationLines.length > 0 ? (
                <ul className="divide-y divide-slate-200">
                  {locationLines.map((loc) => (
                    <li
                      key={loc.id}
                      className="flex items-start gap-2 px-3 py-3 text-sm text-slate-700"
                    >
                      <MapPin
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-brand-blue"
                      />
                      <span className="min-w-0">
                        {loc.label ? (
                          <span className="mb-0.5 block font-medium text-slate-900">
                            {loc.label}
                          </span>
                        ) : null}
                        {loc.line}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : canInlineEdit ? (
                <p className="px-3 py-3 text-sm text-slate-500">
                  Адрес ещё не указан
                </p>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

      <EditPhotoDialog
        key={`photo-${business.imageUrl ?? ""}`}
        businessId={business.id}
        businessSlug={businessSlug}
        imageUrl={business.imageUrl}
        open={editSection === "photo"}
        onClose={() => setEditSection(null)}
      />
      <EditHoursDialog
        key={`hours-${JSON.stringify(business.openingHours)}`}
        businessId={business.id}
        businessSlug={businessSlug}
        hours={business.openingHours}
        open={editSection === "hours"}
        onClose={() => setEditSection(null)}
      />
      <EditAddressDialog
        key={`addr-${business.addressLine}-${business.city}-${business.region}-${business.postalCode}-${business.stateCode}`}
        addressLine={business.addressLine}
        businessId={business.id}
        businessName={business.name}
        businessSlug={businessSlug}
        city={business.city}
        open={editSection === "address"}
        postalCode={business.postalCode ?? null}
        region={business.region}
        stateCode={business.stateCode ?? null}
        onClose={() => setEditSection(null)}
      />
      <EditContactsDialog
        key={`contacts-${business.phone}-${business.email}-${business.website}-${business.telegramUrl}-${business.yelpUrl}`}
        businessId={business.id}
        businessSlug={businessSlug}
        contactLinks={business.contactLinks}
        email={business.email}
        facebookUrl={
          business.facebookUrl || copy.extractedFacebookUrls[0] || null
        }
        googleMapsUrl={business.googleMapsUrl}
        instagramUrl={
          business.instagramUrl || copy.extractedInstagramUrls[0] || null
        }
        open={editSection === "contacts"}
        phone={business.phone}
        telegramUrl={business.telegramUrl}
        website={business.website || copy.extractedWebsiteUrls[0] || null}
        yelpUrl={business.yelpUrl}
        onClose={() => setEditSection(null)}
      />
      {editSection === "about" ? (
        <EditCopyDialog
          key="about"
          about={copy.about ?? ""}
          businessId={business.id}
          businessSlug={businessSlug}
          jobs={copy.jobs ?? ""}
          mode="about"
          open
          promotions={copy.promotions ?? ""}
          onClose={() => setEditSection(null)}
        />
      ) : null}
      {editSection === "jobs" ? (
        <EditCopyDialog
          key="jobs"
          about={copy.about ?? ""}
          businessId={business.id}
          businessSlug={businessSlug}
          jobs={copy.jobs ?? ""}
          mode="jobs"
          open
          promotions={copy.promotions ?? ""}
          onClose={() => setEditSection(null)}
        />
      ) : null}
      {editSection === "promotions" ? (
        <EditCopyDialog
          key="promotions"
          about={copy.about ?? ""}
          businessId={business.id}
          businessSlug={businessSlug}
          jobs={copy.jobs ?? ""}
          mode="promotions"
          open
          promotions={copy.promotions ?? ""}
          onClose={() => setEditSection(null)}
        />
      ) : null}
    </article>
  );
}
