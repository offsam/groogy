import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { FavoriteButton } from "@/components/marketplace/FavoriteButton";
import { OwnerListingActions } from "@/components/marketplace/OwnerListingActions";
import { ReportListingForm } from "@/components/marketplace/ReportListingForm";
import { ErrorState } from "@/components/ui/DataState";
import { formatPrice } from "@/lib/listings/mappers";
import { isListingOwner } from "@/lib/listings/permissions";
import { getListingById } from "@/lib/listings/queries";
import { createServerClient } from "@/lib/supabase/server";
import {
  CONDITION_LABELS,
  LISTING_STATUS_LABELS,
  TRANSACTION_LABELS,
} from "@/types/listing";

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createServerClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://russianbusiness.ai";

  try {
    const listing = await getListingById(supabase, id);
    if (!listing) {
      return {
        title: "Объявление не найдено",
        robots: { index: false, follow: false },
      };
    }

    if (["removed", "rejected", "draft", "archived"].includes(listing.status)) {
      return {
        title: "Объявление недоступно",
        robots: { index: false, follow: false },
      };
    }

    const indexable =
      listing.status === "active" && listing.visibility === "public";
    const description =
      listing.description.trim().slice(0, 160) ||
      "Объявление на Marketplace — КРУГИ";
    const cover = listing.media?.[0]?.publicUrl ?? undefined;

    return {
      title: `${listing.title} — Marketplace`,
      description,
      alternates: { canonical: `${siteUrl}/marketplace/${listing.id}` },
      openGraph: {
        title: listing.title,
        description,
        url: `${siteUrl}/marketplace/${listing.id}`,
        images: cover ? [{ url: cover }] : undefined,
        type: "website",
      },
      robots: indexable ? undefined : { index: false, follow: false },
    };
  } catch {
    return {
      title: "Объявление — Marketplace",
      robots: { index: false, follow: false },
    };
  }
}

function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function ListingDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let listing: Awaited<ReturnType<typeof getListingById>> = null;
  let loadError: string | null = null;

  try {
    listing = await getListingById(supabase, id, user?.id ?? null);
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Не удалось загрузить объявление";
  }

  if (loadError) {
    return <ErrorState detail={loadError} message="Объявление недоступно" />;
  }

  if (!listing) {
    notFound();
  }

  const isOwner = isListingOwner(listing, user?.id ?? null);
  if (
    ["removed", "rejected"].includes(listing.status) &&
    !isOwner
  ) {
    // Owner may still see moderated listing; strangers get a noindex shell
    // without the original title (no existence enumeration beyond "unavailable").
    const { data: isAdmin } = await supabase.rpc("is_admin");
    if (!isAdmin) {
      return (
        <div className="mx-auto max-w-lg py-16 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">
            Объявление недоступно
          </h1>
          <p className="mt-2 text-slate-600">
            Оно снято с публикации или отклонено модерацией.
          </p>
          <Link
            className="mt-6 inline-block text-sm font-medium text-slate-900 underline"
            href="/marketplace"
          >
            Вернуться в Marketplace
          </Link>
        </div>
      );
    }
  }

  const isPublic =
    listing.status === "active" &&
    (listing.visibility === "public" || listing.visibility === "unlisted");

  if (!isOwner && !isPublic && listing.visibility !== "public") {
    if (listing.status !== "active" || listing.visibility === "private") {
      notFound();
    }
  }

  if (
    !isOwner &&
    listing.visibility === "private"
  ) {
    notFound();
  }

  if (
    !isOwner &&
    !["active", "reserved", "completed"].includes(listing.status)
  ) {
    notFound();
  }

  const transactionType = listing.marketplace?.transactionType ?? "sell";
  const location = [listing.city, listing.state].filter(Boolean).join(", ");
  const images = listing.media ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            className="text-sm text-slate-500 hover:text-slate-900"
            href="/marketplace"
          >
            ← Marketplace
          </Link>
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
          {user && !isOwner && (
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
              <span className="ml-2 text-base font-normal text-slate-500">торг</span>
            )}
          </p>

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
                  <MapPin aria-hidden="true" className="size-3.5 text-slate-400" />
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
            <p className="mt-3 whitespace-pre-wrap text-slate-700">
              {listing.description}
            </p>
          </section>
        </div>

        <aside className="space-y-6">
          {listing.author && (
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                {listing.publisher?.publisherType === "business" ? "Бизнес" : "Автор"}
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
                  <Link className="hover:underline" href={listing.author.profilePath}>
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

          {isOwner && (
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="mb-3 text-lg font-semibold text-slate-900">
                Управление
              </h2>
              <OwnerListingActions listingId={listing.id} status={listing.status} />
            </section>
          )}

          {user && !isOwner && (
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <ReportListingForm listingId={listing.id} />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
