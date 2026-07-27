"use client";

import { MapPin, Star } from "lucide-react";
import { BusinessContactsCard } from "@/components/business/profile/BusinessContactsCard";
import { BusinessHoursCard } from "@/components/business/profile/BusinessHoursCard";
import { BusinessLocationsList } from "@/components/business/profile/BusinessLocationsList";
import { BusinessMiniMap } from "@/components/business/profile/BusinessMiniMap";
import { BusinessSourceCard } from "@/components/business/profile/BusinessSourceCard";
import { EditPencil } from "@/components/business/profile/edit/EditPencil";
import type { BusinessPresence } from "@/lib/business/presence";
import type { BusinessLocation } from "@/types/business-location";
import { hasCoordinates, type Business } from "@/types/business";

type BusinessProfileSidebarProps = {
  business: Business;
  businessSlug: string;
  /** Fallback single-line address when there are no location rows. */
  address: string;
  /**
   * Locations for the map block: hub-filtered for visitors,
   * or all locations in edit mode.
   */
  locations?: BusinessLocation[];
  /** True when business has 2+ locations overall (network). */
  isNetwork?: boolean;
  /** Active hub short label for empty-state copy. */
  hubLabel?: string | null;
  presence: BusinessPresence;
  routeUrl?: string | null;
  initiallyRevealed?: boolean;
  isAuthenticated?: boolean;
  extraPhones?: string[];
  fallbackPhone?: string | null;
  fallbackEmail?: string | null;
  editMode?: boolean;
  onEditAddress?: () => void;
  onEditHours?: () => void;
  onEditContacts?: () => void;
};

export function BusinessProfileSidebar({
  business,
  businessSlug,
  address,
  locations = [],
  isNetwork = false,
  hubLabel = null,
  presence,
  routeUrl = null,
  initiallyRevealed = false,
  isAuthenticated = false,
  extraPhones = [],
  fallbackPhone = null,
  fallbackEmail = null,
  editMode = false,
  onEditAddress,
  onEditHours,
  onEditContacts,
}: BusinessProfileSidebarProps) {
  const mapLoc = locations[0] ?? null;
  const mapLat =
    typeof mapLoc?.latitude === "number" && Number.isFinite(mapLoc.latitude)
      ? mapLoc.latitude
      : business.latitude;
  const mapLng =
    typeof mapLoc?.longitude === "number" && Number.isFinite(mapLoc.longitude)
      ? mapLoc.longitude
      : business.longitude;
  const hasMap =
    typeof mapLat === "number" &&
    Number.isFinite(mapLat) &&
    typeof mapLng === "number" &&
    Number.isFinite(mapLng);

  const showAddress = Boolean(
    locations.length > 0 ||
      address ||
      hasMap ||
      editMode ||
      (isNetwork && !editMode),
  );
  const showHours = Boolean(business.openingHours || editMode);
  const title =
    editMode && locations.length > 1
      ? "Адреса и города"
      : locations.length > 1
        ? "Адреса в вашем регионе"
        : "Адрес";

  return (
    <div className="space-y-3">
      {showAddress ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            {editMode && onEditAddress ? (
              <EditPencil label="Редактировать адрес" onClick={onEditAddress} />
            ) : null}
          </div>
          {locations.length > 1 ? (
            <BusinessLocationsList locations={locations} />
          ) : address ? (
            <p className="mt-2 flex items-start gap-2 text-sm text-slate-700">
              <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-slate-400" />
              <span className="leading-snug">{address}</span>
            </p>
          ) : isNetwork && !editMode ? (
            <p className="mt-2 text-sm text-slate-500">
              В регионе
              {hubLabel ? ` «${hubLabel}»` : ""} нет локации этой компании.
            </p>
          ) : editMode ? (
            <p className="mt-2 text-sm text-slate-500">Адрес ещё не указан</p>
          ) : null}
          {hasMap && (locations.length > 0 || hasCoordinates(business)) ? (
            <div className="mt-3">
              <BusinessMiniMap
                lat={mapLat!}
                lng={mapLng!}
                zoom={
                  mapLoc?.locationPrecision === "county" ||
                  mapLoc?.locationPrecision === "city"
                    ? 11
                    : 14
                }
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {showHours ? (
        business.openingHours ? (
          <div className="relative">
            {editMode && onEditHours ? (
              <div className="absolute right-3 top-3 z-10">
                <EditPencil label="Редактировать часы" onClick={onEditHours} />
              </div>
            ) : null}
            <BusinessHoursCard hours={business.openingHours} />
          </div>
        ) : editMode && onEditHours ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Часы работы</h2>
              <EditPencil label="Добавить часы" onClick={onEditHours} />
            </div>
            <p className="mt-2 text-sm text-slate-500">Часы ещё не указаны</p>
          </section>
        ) : null
      ) : null}

      <BusinessContactsCard
        businessId={business.id}
        businessName={business.name}
        businessSlug={businessSlug}
        editMode={editMode}
        email={business.email}
        extraPhones={extraPhones}
        fallbackEmail={fallbackEmail}
        fallbackPhone={fallbackPhone}
        initiallyRevealed={initiallyRevealed}
        isAuthenticated={isAuthenticated}
        phone={business.phone}
        presence={presence}
        presenceFlags={business.presenceFlags}
        routeUrl={routeUrl}
        onEdit={onEditContacts}
      />

      <BusinessSourceCard
        businessSlug={businessSlug}
        editMode={editMode}
        initiallyRevealed={initiallyRevealed}
        isAuthenticated={isAuthenticated}
        presence={presence}
        presenceFlags={business.presenceFlags}
      />

      {(business.googleRating != null || business.googleReviewsCount > 0) && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Google</h2>
          <div className="mt-2 flex items-center gap-2 text-sm text-slate-700">
            <Star aria-hidden="true" className="size-4 fill-amber-500 text-amber-500" />
            {business.googleRating != null ? (
              <span className="font-semibold">{business.googleRating.toFixed(1)}</span>
            ) : null}
            {business.googleReviewsCount > 0 ? (
              <span className="text-slate-500">
                · {business.googleReviewsCount} отзывов
              </span>
            ) : null}
          </div>
        </section>
      )}
    </div>
  );
}
