"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  BadgeCheck,
  Briefcase,
  Camera,
  FileText,
  Heart,
  MessageSquare,
  Percent,
  Plus,
  Sparkles,
  Star,
  Store,
  Users,
} from "lucide-react";
import { BusinessCard } from "@/components/business/BusinessCard";
import { AdminChangeCategoryButton } from "@/components/business/AdminChangeCategoryButton";
import { AdminDeleteBusinessButton } from "@/components/business/AdminDeleteBusinessButton";
import { ClaimBusinessButton } from "@/components/business/ClaimBusinessButton";
import { BusinessGallery } from "@/components/business/profile/BusinessGallery";
import { BusinessHeaderActions } from "@/components/business/profile/BusinessHeaderActions";
import { BusinessProfileSidebar } from "@/components/business/profile/BusinessProfileSidebar";
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
  formatOfficesDescriptionLine,
  pickBusinessLocationsForHubs,
} from "@/lib/business/location-for-hub";
import type { RegionHub } from "@/lib/regions/hubs";
import { structureBusinessProfileCopy } from "@/lib/content/structure-business-profile";
import { hasRealBusinessPhoto } from "@/lib/business/media";
import { formatOfferPrice, offerCoverUrl } from "@/lib/business-offers/mappers";
import { formatAddress } from "@/lib/supabase/mappers";
import { BusinessJobsPanel } from "@/components/business/profile/BusinessJobsPanel";
import type { Job } from "@/types/job";
import type { Business, Category } from "@/types/business";
import type { BusinessOffer } from "@/types/business-offer";
import type { CommunityMention } from "@/types/community-mention";
import {
  formatBusinessLocationLine,
  type BusinessLocation,
} from "@/types/business-location";
import type { Review, ReviewVerificationSession } from "@/types/review";
import type { EntityEngagement } from "@/types/engagement";

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
  businessSlug: string;
  offers: BusinessOffer[];
  jobs: Job[];
  reviews: Review[];
  communityMentions?: CommunityMention[];
  locations?: BusinessLocation[];
  /** Active region hubs from header filter / cookie. */
  activeHubs?: RegionHub[];
  similar: Business[];
  isOwner: boolean;
  isAdmin?: boolean;
  /** Active business categories — only needed for admin category picker. */
  categories?: Category[];
  autoClaim: boolean;
  currentUserId: string | null;
  myReview: Review | null;
  mySession: ReviewVerificationSession | null;
  engagement?: EntityEngagement;
  activeTab?: string | null;
  editMode?: boolean;
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

function durationLabel(offer: BusinessOffer): string | null {
  const attrs = offer.attributes as { duration?: string | null };
  return attrs?.duration?.trim() || null;
}

export function BusinessProfileView({
  business,
  businessSlug,
  offers,
  jobs,
  reviews,
  communityMentions = [],
  locations = [],
  activeHubs = [],
  similar,
  isOwner,
  isAdmin = false,
  categories = [],
  autoClaim,
  currentUserId,
  myReview,
  mySession,
  engagement,
  activeTab: activeTabProp,
  editMode = false,
}: BusinessProfileViewProps) {
  const [editSection, setEditSection] = useState<EditSection>(null);
  const canInlineEdit = isOwner && editMode;
  const isNetwork = locations.length > 1;
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
  const locationLine = hubLocation
    ? [
        hubLocation.city,
        hubLocation.postalCode?.trim() ||
          hubLocation.stateCode?.replace(/^US-/, "") ||
          null,
      ]
        .filter(Boolean)
        .join(", ")
    : [business.city, business.postalCode?.trim() || null]
        .filter(Boolean)
        .join(", ");
  const hubLabel =
    activeHubs.length > 0
      ? activeHubs.map((h) => h.shortLabel).join(", ")
      : null;
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
  const publishedReviewsCount = Math.max(business.reviewsCount, reviews.length);
  const previewMention = communityMentions[0] ?? null;
  const since = platformSinceLabel(business.createdAt);
  const showVerified =
    business.aiVerifiedReviewsCount > 0 ||
    business.transactionVerifiedReviewsCount > 0;
  const engagementState: EntityEngagement = engagement ?? {
    likesCount: business.likesCount ?? 0,
    followersCount: business.followersCount ?? 0,
    likedByMe: false,
    followedByMe: false,
  };

  const copy = structureBusinessProfileCopy(
    business.description,
    business.shortDescription,
  );
  const officesLine = formatOfficesDescriptionLine(locations);
  const aboutText = [copy.about, officesLine].filter(Boolean).join("\n\n") || null;
  const aboutPreviewText =
    [copy.aboutPreview, officesLine].filter(Boolean).join("\n\n") || null;
  // Contacts (incl. extracted from copy) only for owners in edit mode.
  // Everyone else reveals via /api/business/[slug]/contacts after auth.
  const revealContactsInline = canInlineEdit;
  const actionEmail = revealContactsInline
    ? business.email || copy.extractedEmails[0] || null
    : null;

  const tabs: ProfileTab[] = [
    { id: "overview", label: "Обзор" },
    ...(offers.length > 0 || canInlineEdit
      ? [{ id: "services", label: "Услуги" }]
      : []),
    ...(jobs.length > 0 || copy.jobs || isOwner
      ? [{ id: "jobs", label: "Вакансии" }]
      : []),
    ...(copy.promotions || canInlineEdit
      ? [{ id: "promotions", label: "Предложения" }]
      : []),
    { id: "reviews", label: "Отзывы" },
    ...(gallery.length > 0 || canInlineEdit
      ? [{ id: "photos", label: "Фото" }]
      : []),
    ...(aboutText || canInlineEdit
      ? [{ id: "about", label: "О компании" }]
      : []),
  ];
  const tabIds = new Set(tabs.map((t) => t.id));
  const activeTab =
    activeTabProp && tabIds.has(activeTabProp) ? activeTabProp : "overview";
  const editHref = activeTabProp
    ? `/business/${businessSlug}?edit=1&tab=${encodeURIComponent(activeTabProp)}`
    : `/business/${businessSlug}?edit=1`;

  return (
    <article className="business-profile -mx-4 space-y-4 pb-10 sm:mx-0 sm:space-y-5">
      {canInlineEdit ? (
        <div className="px-4 sm:px-0">
          <EditModeBanner activeTab={activeTabProp} businessSlug={businessSlug} />
        </div>
      ) : null}

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

      <div className="relative">
        <BusinessGallery images={gallery} name={business.name} />
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
        <header className="flex gap-3">
          <div
            aria-hidden="true"
            className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-base font-bold tracking-tight text-white sm:size-16 sm:text-lg"
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

            <div className="mt-0.5">
              <p className="truncate text-sm leading-8 text-slate-500">
                {[business.categoryName, locationLine].filter(Boolean).join(" · ")}
              </p>

              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                {publishedReviewsCount > 0 ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
                    <Star
                      aria-hidden="true"
                      className="size-3.5 fill-amber-500 text-amber-500"
                    />
                    {business.ratingAvg.toFixed(1)}
                    <span className="font-normal text-slate-500">
                      ({publishedReviewsCount})
                    </span>
                  </span>
                ) : (
                  <span className="text-slate-500">Пока нет отзывов</span>
                )}
                {engagementState.likesCount > 0 ? (
                  <span className="text-slate-500">
                    {engagementState.likesCount} лайков
                  </span>
                ) : null}
                {engagementState.followersCount > 0 ? (
                  <span className="text-slate-500">
                    {engagementState.followersCount} подписчиков
                  </span>
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

              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {since ? (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                    {since}
                  </span>
                ) : null}
                {isOwner ? (
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
                    {isAdmin ? (
                      <AdminChangeCategoryButton
                        businessId={business.id}
                        businessSlug={businessSlug}
                        categories={categories}
                        currentCategoryId={business.categoryId}
                      />
                    ) : null}
                    {isAdmin && !editMode ? (
                      <>
                        <Link
                          className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                          href={`/admin/businesses/${business.id}/edit`}
                        >
                          Admin
                        </Link>
                        <AdminDeleteBusinessButton
                          businessId={business.id}
                          businessName={business.name}
                          slug={businessSlug}
                        />
                      </>
                    ) : null}
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

              <BusinessHeaderActions
                bookingUrl={business.bookingUrl}
                businessId={business.id}
                businessName={business.name}
                businessSlug={businessSlug}
                className="mt-3 w-full sm:hidden"
                email={actionEmail}
                followedByMe={engagementState.followedByMe}
                followersCount={engagementState.followersCount}
                isAuthenticated={Boolean(currentUserId)}
                likedByMe={engagementState.likedByMe}
                likesCount={engagementState.likesCount}
              />
            </div>
          </div>
          <BusinessHeaderActions
            bookingUrl={business.bookingUrl}
            businessId={business.id}
            businessName={business.name}
            businessSlug={businessSlug}
            className="hidden sm:flex"
            email={actionEmail}
            followedByMe={engagementState.followedByMe}
            followersCount={engagementState.followersCount}
            isAuthenticated={Boolean(currentUserId)}
            likedByMe={engagementState.likedByMe}
            likesCount={engagementState.likesCount}
          />
        </header>

        {/* Mobile: tabs/content first; desktop: sidebar on the right */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17.5rem] lg:items-start">
          <aside className="order-2 space-y-3 lg:order-2 lg:sticky lg:top-24">
            <BusinessProfileSidebar
              address={addressLine}
              business={business}
              businessSlug={businessSlug}
              editMode={canInlineEdit}
              extraPhones={revealContactsInline ? copy.extractedPhones : []}
              fallbackEmail={
                revealContactsInline ? (copy.extractedEmails[0] ?? null) : null
              }
              hubLabel={hubLabel}
              initiallyRevealed={canInlineEdit}
              isAuthenticated={Boolean(currentUserId)}
              isNetwork={isNetwork}
              locations={sidebarLocations}
              presence={
                revealContactsInline
                  ? {
                      website:
                        business.website || copy.extractedWebsiteUrls[0] || null,
                      instagramUrl:
                        business.instagramUrl ||
                        copy.extractedInstagramUrls[0] ||
                        null,
                      telegramUrl: business.telegramUrl,
                      sourceUrl: business.sourceUrl,
                      sourceKind: business.sourceKind,
                      facebookUrl: copy.extractedFacebookUrls[0] ?? null,
                      yelpUrl: business.yelpUrl,
                      bookingUrl: business.bookingUrl,
                      googleMapsUrl:
                        hubLocation?.googleMapsUrl || business.googleMapsUrl,
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
                      yelpUrl: null,
                      bookingUrl: business.bookingUrl,
                      googleMapsUrl: null,
                      googleRating: business.googleRating,
                      googleReviewsCount: business.googleReviewsCount,
                      latitude: hubLocation?.latitude ?? business.latitude,
                      longitude: hubLocation?.longitude ?? business.longitude,
                    }
              }
              routeUrl={revealContactsInline ? mapsUrl : null}
              onEditAddress={() => setEditSection("address")}
              onEditContacts={() => setEditSection("contacts")}
              onEditHours={() => setEditSection("hours")}
            />
          </aside>

          <div className="order-1 space-y-5 lg:order-1">
            <BusinessProfileTabs
              activeTab={activeTab}
              businessSlug={businessSlug}
              editMode={canInlineEdit}
              tabs={tabs}
            />

            {activeTab === "overview" ? (
              <section className="space-y-3" aria-label="Обзор">
                {aboutPreviewText || canInlineEdit ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-base font-semibold text-slate-900">О нас</h2>
                      <div className="flex items-center gap-2">
                        {canInlineEdit ? (
                          <EditPencil
                            label="Редактировать описание"
                            onClick={() => setEditSection("about")}
                          />
                        ) : null}
                        {aboutText && aboutText !== aboutPreviewText ? (
                          <Link
                            className="text-sm font-medium text-brand-blue hover:underline"
                            href={`/business/${businessSlug}?tab=about`}
                            scroll={false}
                          >
                            Подробнее
                          </Link>
                        ) : null}
                      </div>
                    </div>
                    {aboutPreviewText ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                        {aboutPreviewText}
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-slate-500">
                        Добавьте описание компании
                      </p>
                    )}
                  </div>
                ) : null}

                {jobs.length > 0 || copy.jobs || isOwner ? (
                  <div className="rounded-2xl border border-amber-200/80 bg-amber-50/60 p-4 sm:p-5">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="inline-flex items-center gap-1.5 text-base font-semibold text-slate-900">
                        <Briefcase aria-hidden="true" className="size-4 text-amber-700" />
                        Вакансии
                      </h2>
                      {jobs.length > 0 || canInlineEdit ? (
                        <Link
                          className="text-sm font-medium text-brand-blue hover:underline"
                          href={`/business/${businessSlug}?tab=jobs`}
                          scroll={false}
                        >
                          Все
                        </Link>
                      ) : null}
                    </div>
                    <div className="mt-2">
                      <BusinessJobsPanel
                        businessId={business.id}
                        businessSlug={businessSlug}
                        canEdit={isOwner}
                        city={business.city}
                        jobs={jobs.slice(0, 3)}
                      />
                    </div>
                    {jobs.length === 0 && copy.jobs ? (
                      <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                        {copy.jobs}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {copy.promotions || canInlineEdit ? (
                  <div className="rounded-2xl border border-rose-200/80 bg-rose-50/50 p-4 sm:p-5">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="inline-flex items-center gap-1.5 text-base font-semibold text-slate-900">
                        <Percent aria-hidden="true" className="size-4 text-rose-600" />
                        Предложения
                      </h2>
                      <div className="flex items-center gap-2">
                        {canInlineEdit ? (
                          <EditPencil
                            label="Редактировать предложения"
                            onClick={() => setEditSection("promotions")}
                          />
                        ) : null}
                        {copy.promotions ? (
                          <Link
                            className="text-sm font-medium text-brand-blue hover:underline"
                            href={`/business/${businessSlug}?tab=promotions`}
                            scroll={false}
                          >
                            Все
                          </Link>
                        ) : null}
                      </div>
                    </div>
                    {copy.promotions ? (
                      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                        {copy.promotions}
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-slate-500">Предложений пока нет</p>
                    )}
                  </div>
                ) : null}

                {featuredOffers.length > 0 || canInlineEdit ? (
                  <div className="space-y-3">
                    <div className="flex items-end justify-between gap-2 px-0.5">
                      <h2 className="text-base font-semibold text-slate-900">
                        Популярные услуги
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
                        {featuredOffers.length > 0 ? (
                          <Link
                            className="text-sm font-medium text-brand-blue hover:underline"
                            href={`/business/${businessSlug}?tab=services`}
                            scroll={false}
                          >
                            Все
                          </Link>
                        ) : null}
                      </div>
                    </div>
                    {featuredOffers.length > 0 ? (
                      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
                        {featuredOffers.map((offer) => {
                          const cover = offerCoverUrl(offer);
                          const duration = durationLabel(offer);
                          return (
                            <Link
                              key={offer.id}
                              className="w-[9.5rem] shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white transition-shadow hover:shadow-md sm:w-40"
                              href={`/business/${businessSlug}/offers/${offer.slug}`}
                            >
                              <div className="relative aspect-square bg-slate-100">
                                {cover ? (
                                  <Image
                                    alt=""
                                    className="object-cover"
                                    fill
                                    sizes="160px"
                                    src={cover}
                                    unoptimized
                                  />
                                ) : (
                                  <div className="flex h-full items-center justify-center text-xs text-slate-400">
                                    Нет фото
                                  </div>
                                )}
                              </div>
                              <div className="space-y-0.5 p-2.5">
                                <p className="line-clamp-2 text-sm font-medium leading-snug text-slate-900">
                                  {offer.title}
                                </p>
                                <p className="text-sm font-semibold text-slate-900">
                                  {formatOfferPrice(offer)}
                                </p>
                                {duration ? (
                                  <p className="text-xs text-slate-500">{duration}</p>
                                ) : null}
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">
                        Услуг пока нет — добавьте в управлении
                      </p>
                    )}
                  </div>
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
                        Все ({publishedReviewsCount})
                      </Link>
                    </div>
                    <div className="mt-3 space-y-4">
                      {reviews.slice(0, 3).map((review) => (
                        <div key={review.id}>
                          <div className="flex items-center gap-2">
                            <div
                              aria-hidden="true"
                              className="flex size-9 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600"
                            >
                              {(review.authorDisplayName ?? "К")
                                .slice(0, 1)
                                .toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-900">
                                {review.authorDisplayName ?? "Пользователь"}
                              </p>
                              <div className="flex items-center gap-0.5">
                                {Array.from({ length: 5 }, (_, i) => (
                                  <Star
                                    key={i}
                                    aria-hidden="true"
                                    className={`size-3 ${
                                      i < review.rating
                                        ? "fill-amber-500 text-amber-500"
                                        : "text-slate-300"
                                    }`}
                                  />
                                ))}
                              </div>
                            </div>
                          </div>
                          <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-slate-600">
                            {review.body}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {previewMention ? (
                  <BusinessCommunityMentions
                    compact
                    mentions={communityMentions}
                  />
                ) : null}

                <section className="rounded-2xl border border-slate-200 bg-white p-4">
                  <h2 className="text-sm font-semibold text-slate-900">Всё о бизнесе</h2>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div className="rounded-xl bg-slate-50 px-2.5 py-3 text-center">
                      <Store aria-hidden="true" className="mx-auto size-4 text-slate-400" />
                      <p className="mt-1 text-base font-semibold tabular-nums text-slate-900">
                        {offers.length}
                      </p>
                      <p className="text-[11px] text-slate-500">Предложения</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-2.5 py-3 text-center">
                      <MessageSquare aria-hidden="true" className="mx-auto size-4 text-slate-400" />
                      <p className="mt-1 text-base font-semibold tabular-nums text-slate-900">
                        {publishedReviewsCount}
                      </p>
                      <p className="text-[11px] text-slate-500">Отзывы</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-2.5 py-3 text-center">
                      <Camera aria-hidden="true" className="mx-auto size-4 text-slate-400" />
                      <p className="mt-1 text-base font-semibold tabular-nums text-slate-900">
                        {gallery.length}
                      </p>
                      <p className="text-[11px] text-slate-500">Фото</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-2.5 py-3 text-center">
                      <Heart aria-hidden="true" className="mx-auto size-4 text-slate-400" />
                      <p className="mt-1 text-base font-semibold tabular-nums text-slate-900">
                        {engagementState.likesCount}
                      </p>
                      <p className="text-[11px] text-slate-500">Лайки</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-2.5 py-3 text-center">
                      <Users aria-hidden="true" className="mx-auto size-4 text-slate-400" />
                      <p className="mt-1 text-base font-semibold tabular-nums text-slate-900">
                        {engagementState.followersCount}
                      </p>
                      <p className="text-[11px] text-slate-500">Подписчики</p>
                    </div>
                    {jobs.length > 0 || copy.jobs ? (
                      <div className="rounded-xl bg-slate-50 px-2.5 py-3 text-center">
                        <Briefcase aria-hidden="true" className="mx-auto size-4 text-slate-400" />
                        <p className="mt-1 text-base font-semibold tabular-nums text-slate-900">
                          {jobs.length > 0 ? jobs.length : 1}
                        </p>
                        <p className="text-[11px] text-slate-500">Вакансии</p>
                      </div>
                    ) : null}
                    {copy.promotions ? (
                      <div className="rounded-xl bg-slate-50 px-2.5 py-3 text-center">
                        <Percent aria-hidden="true" className="mx-auto size-4 text-slate-400" />
                        <p className="mt-1 text-base font-semibold tabular-nums text-slate-900">1</p>
                        <p className="text-[11px] text-slate-500">Предложения</p>
                      </div>
                    ) : null}
                    {copy.about ? (
                      <div className="rounded-xl bg-slate-50 px-2.5 py-3 text-center">
                        <FileText aria-hidden="true" className="mx-auto size-4 text-slate-400" />
                        <p className="mt-1 text-base font-semibold tabular-nums text-slate-900">1</p>
                        <p className="text-[11px] text-slate-500">Описание</p>
                      </div>
                    ) : null}
                    {business.aiVerifiedReviewsCount > 0 ? (
                      <div className="rounded-xl bg-slate-50 px-2.5 py-3 text-center">
                        <Sparkles aria-hidden="true" className="mx-auto size-4 text-slate-400" />
                        <p className="mt-1 text-base font-semibold tabular-nums text-slate-900">
                          {business.aiVerifiedReviewsCount}
                        </p>
                        <p className="text-[11px] text-slate-500">AI</p>
                      </div>
                    ) : null}
                  </div>
                </section>

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

            {activeTab === "services" && (offers.length > 0 || canInlineEdit) ? (
              <section aria-label="Услуги" className="space-y-3">
                {canInlineEdit ? (
                  <div className="flex justify-end">
                    <Link
                      className="inline-flex items-center gap-1.5 rounded-xl border border-brand-blue/30 bg-brand-blue/5 px-3 py-1.5 text-sm font-medium text-brand-blue-deep hover:bg-brand-blue/10"
                      href={`/business/${businessSlug}/manage`}
                    >
                      <Plus aria-hidden="true" className="size-3.5" />
                      Управление услугами
                    </Link>
                  </div>
                ) : null}
                {offers.length > 0 ? (
                  <BusinessOffersSection
                    businessSlug={businessSlug}
                    offers={offers}
                    presence={{
                      website: revealContactsInline
                        ? business.website || copy.extractedWebsiteUrls[0] || null
                        : null,
                      instagramUrl: revealContactsInline
                        ? business.instagramUrl ||
                          copy.extractedInstagramUrls[0] ||
                          null
                        : null,
                      bookingUrl: business.bookingUrl,
                      googleMapsUrl: revealContactsInline
                        ? business.googleMapsUrl
                        : null,
                      googleRating: business.googleRating,
                      googleReviewsCount: business.googleReviewsCount,
                      latitude: business.latitude,
                      longitude: business.longitude,
                    }}
                  />
                ) : (
                  <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
                    Услуг пока нет. Добавьте их в управлении бизнесом.
                  </p>
                )}
              </section>
            ) : null}

            {activeTab === "jobs" &&
            (jobs.length > 0 || copy.jobs || isOwner) ? (
              <section className="space-y-3" aria-label="Вакансии">
                <h2 className="inline-flex items-center gap-1.5 text-base font-semibold text-slate-900">
                  <Briefcase aria-hidden="true" className="size-4 text-amber-700" />
                  Вакансии
                </h2>
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
              </section>
            ) : null}

            {activeTab === "promotions" && (copy.promotions || canInlineEdit) ? (
              <section className="space-y-3" aria-label="Предложения">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="inline-flex items-center gap-1.5 text-base font-semibold text-slate-900">
                    <Percent aria-hidden="true" className="size-4 text-rose-600" />
                    Предложения
                  </h2>
                  {canInlineEdit ? (
                    <EditPencil
                      label="Редактировать предложения"
                      onClick={() => setEditSection("promotions")}
                    />
                  ) : null}
                </div>
                <div className="rounded-2xl border border-rose-200/80 bg-rose-50/40 p-4 sm:p-5">
                  {copy.promotions ? (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {copy.promotions}
                    </p>
                  ) : (
                    <p className="text-sm text-slate-500">Предложений пока нет</p>
                  )}
                </div>
              </section>
            ) : null}

            {activeTab === "reviews" ? (
              <section aria-label="Отзывы" className="space-y-4">
                {communityMentions.length > 0 ? (
                  <BusinessCommunityMentions mentions={communityMentions} />
                ) : null}
                <BusinessReviewsSection
                  aiVerifiedCount={business.aiVerifiedReviewsCount}
                  businessId={business.id}
                  businessSlug={business.slug}
                  currentUserId={currentUserId}
                  isOwner={isOwner}
                  myReview={myReview}
                  mySession={mySession}
                  ratingAvg={business.ratingAvg}
                  reviews={reviews}
                  reviewsCount={publishedReviewsCount}
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

            {activeTab === "about" && (aboutText || canInlineEdit) ? (
              <section className="space-y-3" aria-label="О компании">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-slate-900">О компании</h2>
                  {canInlineEdit ? (
                    <EditPencil
                      label="Редактировать описание"
                      onClick={() => setEditSection("about")}
                    />
                  ) : null}
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  {aboutText ? (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                      {aboutText}
                    </p>
                  ) : (
                    <p className="text-sm text-slate-500">Описание ещё не добавлено</p>
                  )}
                  {locationLine ? (
                    <p className="mt-3 text-sm text-slate-500">{locationLine}</p>
                  ) : null}
                </div>
              </section>
            ) : null}
          </div>
        </div>
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
        key={`contacts-${business.phone}-${business.email}-${business.website}`}
        businessId={business.id}
        businessSlug={businessSlug}
        email={business.email}
        facebookUrl={copy.extractedFacebookUrls[0] ?? null}
        googleMapsUrl={business.googleMapsUrl}
        instagramUrl={
          business.instagramUrl || copy.extractedInstagramUrls[0] || null
        }
        open={editSection === "contacts"}
        phone={business.phone}
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
          shortDescription={business.shortDescription ?? ""}
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
          shortDescription={business.shortDescription ?? ""}
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
          shortDescription={business.shortDescription ?? ""}
          onClose={() => setEditSection(null)}
        />
      ) : null}
    </article>
  );
}
