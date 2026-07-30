"use client";

import Image from "next/image";
import Link from "next/link";
import { MapPin, Star } from "lucide-react";
import { ProfessionalOriginBadges } from "@/components/professional/ProfessionalOriginBadges";
import { PaymentMethodIcons } from "@/components/shared/PaymentMethodIcons";
import { normalizeUsZip } from "@/lib/brand";
import { resolvePublicCityPostal } from "@/lib/address/normalize";
import { professionalCardBlurb } from "@/lib/professional/card-blurb";
import type { Professional } from "@/types/professional";

type ProfessionalCardProps = {
  professional: Professional;
  /** Admin moderation: no public links. */
  preview?: boolean;
};

/** Listing location: «Irvine, 92612» (city + ZIP). */
export function professionalCardLocationLabel(
  professional: Professional,
): string | null {
  const { city, postalCode } = resolvePublicCityPostal({
    city: professional.city,
    region: professional.region,
    stateCode: professional.stateCode,
    postalCode: professional.postalCode,
    shortDescription: professional.shortDescription,
    description: professional.description,
  });
  const zip = postalCode ? normalizeUsZip(postalCode) : null;
  if (city && zip) return `${city}, ${zip}`;
  if (city) return city;
  if (zip) return zip;
  return null;
}

export function ProfessionalCard({
  professional,
  preview = false,
}: ProfessionalCardProps) {
  const location = professionalCardLocationLabel(professional);
  const photo =
    professional.imageUrl && professional.imageUrl !== "/placeholder.svg"
      ? professional.imageUrl
      : null;
  const blurb = professionalCardBlurb({
    headline: professional.headline,
    shortDescription: professional.shortDescription,
    description: professional.description,
    cardSummary: professional.cardSummary,
    servicePreviewTitles: professional.servicePreviewTitles,
    categoryName: professional.categoryName,
    categorySlug: professional.categorySlug,
  });

  const body = (
    <>
      <div className="relative aspect-[4/3] shrink-0 bg-slate-100">
        {photo ? (
          <Image
            alt={professional.displayName}
            className="object-cover"
            fill
            sizes="(max-width: 640px) 100vw, 33vw"
            src={photo}
            unoptimized={preview}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-brand-blue/15 via-white to-brand-green/10">
            <span className="font-[family-name:var(--font-display)] text-3xl font-semibold text-slate-400">
              {professional.displayName.slice(0, 2).toUpperCase()}
            </span>
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-3.5 sm:p-4">
        <h2 className="truncate text-[15px] font-semibold text-slate-900">
          {professional.displayName}
        </h2>
        <p className="line-clamp-2 min-h-[2.5rem] text-sm leading-snug text-slate-600">
          {blurb || "\u00A0"}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-slate-500">
          {professional.ratingAvg > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Star className="size-3.5 fill-brand-orange text-brand-orange" />
              {professional.ratingAvg.toFixed(1)}
            </span>
          ) : null}
          {location ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin className="size-3.5 shrink-0" />
              <span className="truncate">{location}</span>
            </span>
          ) : null}
        </div>
        <ProfessionalOriginBadges compact professional={professional} />
        {professional.paymentMethods?.length ? (
          <PaymentMethodIcons
            className="mt-1.5 w-full justify-end"
            methods={professional.paymentMethods}
            size="sm"
          />
        ) : null}
      </div>
    </>
  );

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition-shadow hover:shadow-md">
      {preview ? (
        <div className="flex h-full flex-col">{body}</div>
      ) : (
        <Link
          className="flex h-full flex-col"
          href={`/professional/${professional.slug}`}
        >
          {body}
        </Link>
      )}
    </article>
  );
}
