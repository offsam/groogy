import Image from "next/image";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { FavoriteButton } from "@/components/marketplace/FavoriteButton";
import { OwnerListingActions } from "@/components/marketplace/OwnerListingActions";
import { ReportListingForm } from "@/components/marketplace/ReportListingForm";
import { ListingSourceCard } from "@/components/listings/ListingSourceCard";
import { AdminLensBar } from "@/components/admin/AdminLensBar";
import { DescriptionWithOriginal } from "@/components/shared/DescriptionWithOriginal";
import { PaymentMethodsCard } from "@/components/shared/PaymentMethodsCard";
import { formatPrice, stripListingSource } from "@/lib/listings/mappers";
import {
  CONDITION_LABELS,
  LISTING_STATUS_LABELS,
  TRANSACTION_LABELS,
  type Listing,
} from "@/types/listing";

function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}

export function MarketplaceListingProfileView({
  listing,
  preview = false,
  isAuthenticated = false,
  isOwner = false,
  isAdmin = false,
}: {
  listing: Listing;
  preview?: boolean;
  isAuthenticated?: boolean;
  isOwner?: boolean;
  isAdmin?: boolean;
  currentUserId?: string | null;
}) {
  const isPublic =
    listing.status === "active" &&
    (listing.visibility === "public" || listing.visibility === "unlisted");

  const transactionType = listing.marketplace?.transactionType ?? "sell";
  const location = [listing.city, listing.state].filter(Boolean).join(", ");
  const images = listing.media ?? [];
  const publicListing =
    preview || isAuthenticated ? listing : stripListingSource(listing);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {isAdmin && !preview ? (
        <AdminLensBar entityId={listing.id} kind="marketplace" />
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {!preview ? (
            <Link
              className="text-sm text-slate-500 hover:text-slate-900"
              href="/marketplace"
            >
              ← Marketplace
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
            {formatPrice(
              listing.priceAmount,
              listing.priceCurrency,
              transactionType,
            )}
            {listing.isNegotiable && transactionType === "sell" && (
              <span className="ml-2 text-base font-normal text-slate-500">
                торг
              </span>
            )}
          </p>
          <PaymentMethodsCard methods={listing.paymentMethods} />

          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Тип сделки</dt>
              <dd className="font-medium text-slate-900">
                {TRANSACTION_LABELS[transactionType]}
              </dd>
            </div>
            {listing.marketplace?.condition && (
              <div>
                <dt className="text-slate-500">Состояние</dt>
                <dd className="font-medium text-slate-900">
                  {CONDITION_LABELS[listing.marketplace.condition]}
                </dd>
              </div>
            )}
            {listing.marketplace?.category && (
              <div>
                <dt className="text-slate-500">Категория</dt>
                <dd className="font-medium text-slate-900">
                  {listing.marketplace.category.nameRu}
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
            <div>
              <dt className="text-slate-500">Доставка / самовывоз</dt>
              <dd className="font-medium text-slate-900">
                {[
                  listing.marketplace?.pickupAvailable && "Самовывоз",
                  listing.marketplace?.deliveryAvailable && "Доставка",
                ]
                  .filter(Boolean)
                  .join(", ") || "—"}
              </dd>
            </div>
          </dl>

          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Описание</h2>
            <DescriptionWithOriginal
              className="mt-3"
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
          {listing.author && (
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                {listing.publisher?.publisherType === "business"
                  ? "Бизнес"
                  : "Автор"}
              </h2>
              <p className="mt-2 font-medium text-slate-900">
                {listing.publisher?.publisherType === "business" &&
                listing.publisher.slug ? (
                  <Link
                    className="hover:underline"
                    href={`/business/${listing.publisher.slug}`}
                  >
                    {listing.publisher.name}
                  </Link>
                ) : listing.author.profilePath ? (
                  <Link
                    className="hover:underline"
                    href={listing.author.profilePath}
                  >
                    {listing.publisher?.name ?? listing.author.label}
                  </Link>
                ) : (
                  listing.publisher?.name ?? listing.author.label
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
              <OwnerListingActions
                listingId={listing.id}
                status={listing.status}
              />
            </section>
          )}

          {!preview && isAuthenticated && !isOwner && (
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <ReportListingForm listingId={listing.id} />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
