import Image from "next/image";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { AdminLensBar } from "@/components/admin/AdminLensBar";
import { FavoriteButton } from "@/components/marketplace/FavoriteButton";
import { ReportListingForm } from "@/components/marketplace/ReportListingForm";
import { ClaimListingButton } from "@/components/claims/ClaimListingButton";
import { ServiceOwnerActions } from "@/components/services/ServiceOwnerActions";
import { ListingSourceCard } from "@/components/listings/ListingSourceCard";
import { DescriptionWithOriginal } from "@/components/shared/DescriptionWithOriginal";
import { PaymentMethodsCard } from "@/components/shared/PaymentMethodsCard";
import { formatServicePrice, stripListingSource } from "@/lib/listings/mappers";
import {
  LISTING_STATUS_LABELS,
  SERVICE_MODE_LABELS,
  SERVICE_PRICING_LABELS,
  SERVICE_REPORT_REASONS,
  type Listing,
} from "@/types/listing";

function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}

export function ServiceProfileView({
  listing,
  preview = false,
  isAuthenticated = false,
  isOwner = false,
  isAdmin = false,
  autoClaim = false,
}: {
  listing: Listing;
  preview?: boolean;
  isAuthenticated?: boolean;
  isOwner?: boolean;
  isAdmin?: boolean;
  autoClaim?: boolean;
  currentUserId?: string | null;
}) {
  const isPublic =
    listing.status === "active" &&
    (listing.visibility === "public" || listing.visibility === "unlisted");

  const service = listing.service;
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
      {isAdmin && !preview ? (
        <AdminLensBar entityId={listing.id} kind="service" />
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {!preview ? (
            <Link
              className="text-sm text-slate-500 hover:text-slate-900"
              href="/services"
            >
              ← Услуги
            </Link>
          ) : null}
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
            {listing.title}
          </h1>
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
              kind="services"
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
      ) : (
        <div className="flex aspect-[16/9] items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
          Нет фотографий
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <p className="text-3xl font-bold text-slate-900">
            {service
              ? formatServicePrice(service, listing.priceCurrency)
              : "Цена не указана"}
          </p>
          <PaymentMethodsCard methods={listing.paymentMethods} />

          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {service?.pricingType && (
              <div>
                <dt className="text-slate-500">Тип цены</dt>
                <dd className="font-medium text-slate-900">
                  {SERVICE_PRICING_LABELS[service.pricingType]}
                </dd>
              </div>
            )}
            {service?.category && (
              <div>
                <dt className="text-slate-500">Категория</dt>
                <dd className="font-medium text-slate-900">
                  {service.category.nameRu}
                </dd>
              </div>
            )}
            {service?.serviceModes && service.serviceModes.length > 0 && (
              <div>
                <dt className="text-slate-500">Формат</dt>
                <dd className="font-medium text-slate-900">
                  {service.serviceModes
                    .map((m) => SERVICE_MODE_LABELS[m])
                    .join(", ")}
                </dd>
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
            {service?.serviceArea && (
              <div>
                <dt className="text-slate-500">Зона обслуживания</dt>
                <dd className="font-medium text-slate-900">
                  {service.serviceArea}
                </dd>
              </div>
            )}
            {service?.experienceYears != null && (
              <div>
                <dt className="text-slate-500">Опыт</dt>
                <dd className="font-medium text-slate-900">
                  {service.experienceYears} лет
                </dd>
              </div>
            )}
            {service?.languages && service.languages.length > 0 && (
              <div>
                <dt className="text-slate-500">Языки</dt>
                <dd className="font-medium text-slate-900">
                  {service.languages.join(", ")}
                </dd>
              </div>
            )}
            {service?.licenseInfo && (
              <div>
                <dt className="text-slate-500">Лицензия</dt>
                <dd className="font-medium text-slate-900">
                  {service.licenseInfo}
                </dd>
              </div>
            )}
            {service?.availabilityText && (
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Доступность</dt>
                <dd className="font-medium text-slate-900">
                  {service.availabilityText}
                </dd>
              </div>
            )}
            {(service?.offersFreeEstimate ||
              service?.offersEmergencyService) && (
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Дополнительно</dt>
                <dd className="font-medium text-slate-900">
                  {[
                    service.offersFreeEstimate && "Бесплатная оценка",
                    service.offersEmergencyService && "Срочный выезд",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
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
                  : "Исполнитель"}
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
              <ServiceOwnerActions
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
