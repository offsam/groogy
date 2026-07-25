import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { FavoriteButton } from "@/components/marketplace/FavoriteButton";
import { ReportListingForm } from "@/components/marketplace/ReportListingForm";
import { ServiceOwnerActions } from "@/components/services/ServiceOwnerActions";
import { ErrorState } from "@/components/ui/DataState";
import { formatServicePrice } from "@/lib/listings/mappers";
import { isListingOwner } from "@/lib/listings/permissions";
import { getListingById } from "@/lib/listings/queries";
import { createServerClient } from "@/lib/supabase/server";
import {
  LISTING_STATUS_LABELS,
  SERVICE_MODE_LABELS,
  SERVICE_PRICING_LABELS,
  SERVICE_REPORT_REASONS,
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
    if (!listing || listing.listingType !== "service") {
      return {
        title: "Услуга не найдена",
        robots: { index: false, follow: false },
      };
    }

    if (["removed", "rejected", "draft", "archived"].includes(listing.status)) {
      return {
        title: "Услуга недоступна",
        robots: { index: false, follow: false },
      };
    }

    const indexable =
      listing.status === "active" && listing.visibility === "public";
    const description =
      listing.description.trim().slice(0, 160) ||
      "Услуга — КРУГИ";
    const cover = listing.media?.[0]?.publicUrl ?? undefined;

    return {
      title: `${listing.title} — Услуги`,
      description,
      alternates: { canonical: `${siteUrl}/services/${listing.id}` },
      openGraph: {
        title: listing.title,
        description,
        url: `${siteUrl}/services/${listing.id}`,
        images: cover ? [{ url: cover }] : undefined,
        type: "website",
      },
      robots: indexable ? undefined : { index: false, follow: false },
    };
  } catch {
    return {
      title: "Услуга",
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

export default async function ServiceDetailPage({ params }: PageProps) {
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
    loadError = err instanceof Error ? err.message : "Не удалось загрузить услугу";
  }

  if (loadError) {
    return <ErrorState detail={loadError} message="Услуга недоступна" />;
  }

  if (!listing || listing.listingType !== "service") {
    notFound();
  }

  const isOwner = isListingOwner(listing, user?.id ?? null);
  if (["removed", "rejected"].includes(listing.status) && !isOwner) {
    const { data: isAdmin } = await supabase.rpc("is_admin");
    if (!isAdmin) {
      return (
        <div className="mx-auto max-w-lg py-16 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">
            Услуга недоступна
          </h1>
          <p className="mt-2 text-slate-600">
            Она снята с публикации или отклонена модерацией.
          </p>
          <Link
            className="mt-6 inline-block text-sm font-medium text-slate-900 underline"
            href="/services"
          >
            Вернуться к услугам
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

  if (!isOwner && listing.visibility === "private") {
    notFound();
  }

  if (!isOwner && !["active", "completed"].includes(listing.status)) {
    notFound();
  }

  const service = listing.service;
  const location = [listing.city, listing.state].filter(Boolean).join(", ");
  const images = listing.media ?? [];
  const publisherLabel =
    listing.publisher?.name ?? listing.author?.label ?? null;
  const publisherHref =
    listing.publisher?.publisherType === "business" && listing.publisher.slug
      ? `/business/${listing.publisher.slug}`
      : listing.author?.profilePath;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            className="text-sm text-slate-500 hover:text-slate-900"
            href="/services"
          >
            ← Услуги
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
            {service
              ? formatServicePrice(service, listing.priceCurrency)
              : "Цена не указана"}
          </p>

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
                  <MapPin aria-hidden="true" className="size-3.5 text-slate-400" />
                  {location}
                </dd>
              </div>
            )}
            {service?.serviceArea && (
              <div>
                <dt className="text-slate-500">Зона обслуживания</dt>
                <dd className="font-medium text-slate-900">{service.serviceArea}</dd>
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
                <dd className="font-medium text-slate-900">{service.licenseInfo}</dd>
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
            {(service?.offersFreeEstimate || service?.offersEmergencyService) && (
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
            <h2 className="text-lg font-semibold text-slate-900">Описание</h2>
            <p className="mt-3 whitespace-pre-wrap text-slate-700">
              {listing.description}
            </p>
          </section>
        </div>

        <aside className="space-y-6">
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

          {isOwner && (
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="mb-3 text-lg font-semibold text-slate-900">
                Управление
              </h2>
              <ServiceOwnerActions listingId={listing.id} status={listing.status} />
            </section>
          )}

          {user && !isOwner && (
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
