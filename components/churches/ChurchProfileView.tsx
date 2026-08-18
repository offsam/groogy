"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock, MapPin } from "lucide-react";
import {
  AdminLensBar,
  type AdminLensViewAs,
} from "@/components/admin/AdminLensBar";
import { BusinessGallery } from "@/components/business/profile/BusinessGallery";
import { BusinessHoursCard } from "@/components/business/profile/BusinessHoursCard";
import { BusinessMiniMap } from "@/components/business/profile/BusinessMiniMap";
import { ChurchContactsCard } from "@/components/churches/ChurchContactsCard";
import { ChurchMinistriesSection } from "@/components/churches/ChurchMinistriesSection";
import { ChurchSourceCard } from "@/components/churches/ChurchSourceCard";
import { DescriptionWithOriginal } from "@/components/shared/DescriptionWithOriginal";
import { hasRealBusinessPhoto } from "@/lib/business/media";
import { looksLikeStreetAddress } from "@/lib/business/location-precision";
import { redactContactsFromPublicText } from "@/lib/content/structure-business-profile";
import type { Church } from "@/types/church";

type ChurchProfileViewProps = {
  church: Church;
  currentUserId: string | null;
  isAdmin?: boolean;
  /** Admin catalog preview: contacts visible. */
  preview?: boolean;
  cityMapCenter?: { lat: number; lng: number } | null;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "К";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function ChurchProfileView({
  church,
  currentUserId,
  isAdmin = false,
  preview = false,
  cityMapCenter = null,
}: ChurchProfileViewProps) {
  const [viewAs, setViewAs] = useState<AdminLensViewAs>("owner");

  const location = [
    church.addressLine,
    church.city,
    church.region || church.stateCode,
    church.postalCode,
  ]
    .filter(Boolean)
    .join(", ");

  const hasEntityCoords =
    typeof church.latitude === "number" &&
    Number.isFinite(church.latitude) &&
    typeof church.longitude === "number" &&
    Number.isFinite(church.longitude);
  const streetLine = church.addressLine?.trim() || "";
  const exactPin =
    hasEntityCoords &&
    Boolean(streetLine) &&
    (church.locationPrecision === "street" ||
      (church.locationPrecision !== "county" &&
        church.locationPrecision !== "city" &&
        looksLikeStreetAddress(streetLine)));
  const mapLat = exactPin
    ? church.latitude
    : (cityMapCenter?.lat ?? (hasEntityCoords ? church.latitude : null));
  const mapLng = exactPin
    ? church.longitude
    : (cityMapCenter?.lng ?? (hasEntityCoords ? church.longitude : null));

  const about = redactContactsFromPublicText(church.description);
  const aboutOriginal = redactContactsFromPublicText(
    church.descriptionOriginal,
  );

  const gallery = [church.imageUrl, ...(church.galleryUrls ?? [])].filter(
    (url, i, arr): url is string =>
      Boolean(url && hasRealBusinessPhoto(url) && arr.indexOf(url) === i),
  );

  const showAdminChrome = isAdmin && !preview;
  const showOwnerContacts =
    preview || (showAdminChrome && viewAs === "owner");

  const publicChurch: Church =
    showOwnerContacts
      ? church
      : {
          ...church,
          phone: null,
          email: null,
          website: null,
          instagramUrl: null,
          telegramUrl: null,
          contactLinks: [],
          sourceUrl: null,
          googleMapsUrl: null,
        };

  // Reveal only when plaintext is actually on the object we pass to cards.
  // Never force-reveal on «владелец» alone — if owner payload failed to load,
  // keep the gated chips so «Показать» can fetch via API.
  const showContactsRevealed = Boolean(
    publicChurch.phone ||
      publicChurch.email ||
      publicChurch.website ||
      publicChurch.instagramUrl ||
      publicChurch.telegramUrl ||
      publicChurch.contactLinks.length > 0,
  );
  const showSourceRevealed = Boolean(
    publicChurch.sourceUrl || publicChurch.sourceKind === "platform",
  );

  const since = church.createdAt
    ? `На платформе с ${new Date(church.createdAt).getFullYear()}`
    : null;

  return (
    <div className="mx-auto max-w-5xl space-y-4 py-4 sm:px-6 sm:py-8">
      {preview ? (
        <p className="mx-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 sm:mx-0">
          Предпросмотр публикации
        </p>
      ) : null}

      {showAdminChrome ? (
        <div className="px-3 sm:px-0">
          <AdminLensBar
            entityId={church.id}
            kind="church"
            slug={church.slug}
            title={church.name}
            viewAs={viewAs}
            onViewAsChange={setViewAs}
          />
          {viewAs === "visitor" ? (
            <p className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
              Вид как у обычного пользователя — контакты скрыты за «Показать»
            </p>
          ) : (
            <p className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-brand-blue/20 bg-brand-blue/5 px-3 py-2 text-sm text-slate-700">
              <span>Редактирование карточки</span>
              <Link
                className="font-semibold text-brand-blue hover:underline"
                href={`/admin/catalog/churches/${church.id}/edit`}
              >
                Открыть форму
              </Link>
            </p>
          )}
        </div>
      ) : null}

      <div className="relative">
        <BusinessGallery
          flush={preview}
          images={gallery}
          name={church.name}
          showLogoBadge={false}
        />
      </div>

      <div className="space-y-4 px-3 sm:px-0">
        <header className="space-y-2">
          <div className="flex flex-wrap gap-3">
            <div
              aria-hidden
              className="hidden size-16 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-lg font-bold tracking-tight sm:flex"
              style={{ color: "#ffffff" }}
            >
              {initials(church.name)}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                {church.name}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                {since ? (
                  <span className="text-xs text-slate-400">{since}</span>
                ) : null}
                {location ? (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                    <MapPin aria-hidden className="size-3.5 shrink-0" />
                    {[church.city, church.stateCode || church.region]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <aside className="order-1 space-y-3 lg:order-2 lg:sticky lg:top-24">
            {location ? (
              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <h2 className="text-sm font-semibold text-slate-900">Адрес</h2>
                <p className="mt-2 flex items-start gap-1.5 text-sm text-slate-700">
                  <MapPin
                    aria-hidden
                    className="mt-0.5 size-3.5 shrink-0 text-slate-400"
                  />
                  <span>{location}</span>
                </p>
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

            <ChurchContactsCard
              church={publicChurch}
              initiallyRevealed={showContactsRevealed}
              isAuthenticated={
                showOwnerContacts ? true : Boolean(currentUserId)
              }
            />

            <ChurchSourceCard
              church={publicChurch}
              initiallyRevealed={showSourceRevealed}
              isAuthenticated={
                showOwnerContacts ? true : Boolean(currentUserId)
              }
            />
          </aside>

          <div className="order-2 space-y-4 lg:order-1">
            {about ? (
              <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <DescriptionWithOriginal
                  heading="О нас"
                  original={aboutOriginal}
                  text={about}
                  textClassName="text-base leading-relaxed text-slate-800"
                />
              </section>
            ) : (
              <section className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 sm:p-5">
                Описание пока не заполнено.
                {showAdminChrome ? (
                  <>
                    {" "}
                    <Link
                      className="font-semibold text-brand-blue hover:underline"
                      href={`/admin/catalog/churches/${church.id}/edit`}
                    >
                      Добавить в админке
                    </Link>
                  </>
                ) : null}
              </section>
            )}

            {church.openingHours ? (
              <BusinessHoursCard
                hours={church.openingHours}
                title="Расписание"
              />
            ) : church.scheduleText ? (
              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <Clock aria-hidden className="size-4 text-slate-400" />
                  Расписание
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-700">
                  {church.scheduleText}
                </p>
              </section>
            ) : null}

            <ChurchMinistriesSection
              ministries={church.ministries ?? []}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
