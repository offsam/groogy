import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { MapPin } from "lucide-react";
import { FavoriteButton } from "@/components/marketplace/FavoriteButton";
import { ReportListingForm } from "@/components/marketplace/ReportListingForm";
import { ClaimListingButton } from "@/components/claims/ClaimListingButton";
import { LechuOwnerActions } from "@/components/lechu/LechuOwnerActions";
import { LechuRoutePlaque } from "@/components/lechu/LechuRoutePlaque";
import { ListingSourceCard } from "@/components/listings/ListingSourceCard";
import { AdminLensBar } from "@/components/admin/AdminLensBar";
import { DescriptionWithOriginal } from "@/components/shared/DescriptionWithOriginal";
import { PaymentMethodsCard } from "@/components/shared/PaymentMethodsCard";
import { stripListingSource } from "@/lib/listings/mappers";
import {
  LECHU_CARRY_TYPE_LABELS,
  LECHU_REWARD_LABELS,
  LISTING_STATUS_LABELS,
  SERVICE_REPORT_REASONS,
  type Listing,
} from "@/types/listing";

function formatDate(value: string | null, withTime = true) {
  if (!value) return null;
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    ...(withTime ? { timeStyle: "short" as const } : {}),
  }).format(new Date(value));
}

export function LechuProfileView({
  listing,
  preview = false,
  isAuthenticated = false,
  isOwner = false,
  isAdmin = false,
  autoClaim = false,
  adminChrome = null,
}: {
  listing: Listing;
  preview?: boolean;
  isAuthenticated?: boolean;
  isOwner?: boolean;
  isAdmin?: boolean;
  autoClaim?: boolean;
  currentUserId?: string | null;
  adminChrome?: ReactNode;
}) {
  const isPublic =
    listing.status === "active" &&
    (listing.visibility === "public" || listing.visibility === "unlisted");

  const lechu = listing.lechu;
  const location = [listing.city, listing.state].filter(Boolean).join(", ");
  const images = listing.media ?? [];
  const publicListing =
    preview || isAuthenticated ? listing : stripListingSource(listing);
  const publisherLabel =
    listing.publisher?.name ?? listing.author?.label ?? null;
  const publisherHref =
    listing.publisher?.publisherType === "business" && listing.publisher.slug
      ? `/business/${listing.publisher.slug}`
      : listing.author?.profilePath;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {adminChrome ? (
        adminChrome
      ) : isAdmin && !preview ? (
        <AdminLensBar entityId={listing.id} kind="lechu" />
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {!preview ? (
            <Link
              className="text-sm text-slate-500 hover:text-slate-900"
              href="/lechu"
            >
              ← Лечу
            </Link>
          ) : null}
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
            {listing.title}
          </h1>
          {lechu?.departureCountry && lechu?.destinationCountry ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-4 sm:px-5">
              <LechuRoutePlaque
                departure={lechu.departureCountry}
                destination={lechu.destinationCountry}
                departureDate={lechu.departureDate}
                size="profile"
              />
            </div>
          ) : null}
          {!isPublic && isOwner && (
            <p className="mt-1 text-sm text-amber-700">
              Статус: {LISTING_STATUS_LABELS[listing.status]}
              {listing.visibility !== "public" && ` · ${listing.visibility}`}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {!preview && !isOwner ? (
            <ClaimListingButton
              autoSubmit={autoClaim}
              checkStatus
              kind="lechu"
              listingId={listing.id}
            />
          ) : null}
          {!preview && isAuthenticated && !isOwner && (
            <FavoriteButton
              favoritesCount={listing.favoritesCount}
              initialFavorited={listing.favoritedByMe ?? false}
              listingId={listing.id}
            />
          )}
        </div>
      </div>

      {images.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {images.map((item, index) => (
            <div
              key={item.id}
              className={`relative overflow-hidden rounded-2xl bg-slate-100 ${
                index === 0 ? "sm:col-span-2 aspect-[16/9]" : "aspect-square"
              }`}
            >
              {item.publicUrl && (
                <Image
                  alt={`${listing.title} — фото ${index + 1}`}
                  className="object-cover"
                  fill
                  priority={index === 0}
                  sizes="(max-width: 768px) 100vw, 800px"
                  src={item.publicUrl}
                  unoptimized
                />
              )}
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <p className="text-3xl font-bold text-slate-900">
            {lechu?.rewardType
              ? LECHU_REWARD_LABELS[lechu.rewardType]
              : "Условия не указаны"}
          </p>
          <PaymentMethodsCard methods={listing.paymentMethods} />

          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {lechu?.departureDate && (
              <div>
                <dt className="text-slate-500">Дата вылета</dt>
                <dd className="font-medium text-slate-900">
                  {formatDate(lechu.departureDate, false)}
                </dd>
              </div>
            )}
            {lechu?.category && (
              <div>
                <dt className="text-slate-500">Категория</dt>
                <dd className="font-medium text-slate-900">
                  {lechu.category.nameRu}
                </dd>
              </div>
            )}
            {lechu?.carryTypes && lechu.carryTypes.length > 0 && (
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Могу взять</dt>
                <dd className="font-medium text-slate-900">
                  {lechu.carryTypes
                    .map(
                      (t) =>
                        LECHU_CARRY_TYPE_LABELS[
                          t as keyof typeof LECHU_CARRY_TYPE_LABELS
                        ] ?? t,
                    )
                    .join(", ")}
                </dd>
              </div>
            )}
            {lechu?.maxWeightKg != null && (
              <div>
                <dt className="text-slate-500">Макс. вес</dt>
                <dd className="font-medium text-slate-900">
                  {lechu.maxWeightKg} кг
                </dd>
              </div>
            )}
            {lechu?.sizeLimit && (
              <div>
                <dt className="text-slate-500">Размер</dt>
                <dd className="font-medium text-slate-900">{lechu.sizeLimit}</dd>
              </div>
            )}
            {location && (
              <div>
                <dt className="text-slate-500">Локация</dt>
                <dd className="flex items-center gap-1 font-medium text-slate-900">
                  <MapPin
                    aria-hidden="true"
                    className="size-3.5 text-slate-400"
                  />
                  {location}
                </dd>
              </div>
            )}
          </dl>

          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <DescriptionWithOriginal
              heading="Описание"
              headingClassName="text-lg font-semibold text-slate-900"
              original={listing.descriptionOriginal}
              text={listing.description}
              textClassName="text-slate-700"
            />
          </section>
        </div>

        <aside className="space-y-6">
          <ListingSourceCard
            hasSource={publicListing.hasSource}
            initiallyRevealed={
              preview
                ? true
                : Boolean(isAuthenticated && publicListing.sourceUrl)
            }
            isAuthenticated={preview ? true : Boolean(isAuthenticated)}
            listingId={publicListing.id}
            sourceKind={publicListing.sourceKind}
            sourceUrl={publicListing.sourceUrl}
          />
          {publisherLabel && (
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                {listing.publisher?.publisherType === "business"
                  ? "Бизнес"
                  : "Путешественник"}
              </h2>
              <p className="mt-2 font-medium text-slate-900">
                {publisherHref ? (
                  <Link className="hover:underline" href={publisherHref}>
                    {publisherLabel}
                  </Link>
                ) : (
                  publisherLabel
                )}
              </p>
              {formatDate(listing.publishedAt ?? listing.createdAt) && (
                <p className="mt-1 text-xs text-slate-500">
                  {formatDate(listing.publishedAt ?? listing.createdAt)}
                </p>
              )}
            </section>
          )}

          {!preview && isOwner && (
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="mb-3 text-lg font-semibold text-slate-900">
                Управление
              </h2>
              <LechuOwnerActions
                listingId={listing.id}
                status={listing.status}
              />
            </section>
          )}

          {!preview && isAuthenticated && !isOwner && (
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <ReportListingForm
                listingId={listing.id}
                reasons={SERVICE_REPORT_REASONS}
              />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
