import Image from "next/image";
import Link from "next/link";
import { MapPin, Star } from "lucide-react";
import { normalizeUsZip } from "@/lib/brand";
import { resolvePublicCityPostal } from "@/lib/address/normalize";
import { professionalCardBlurb } from "@/lib/professional/card-blurb";
import type { Professional } from "@/types/professional";

type Props = {
  professional: Professional;
};

function locationLabel(professional: Professional): string | null {
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

/**
 * Category / «Все» list row: thumb + name → rating → service → city pin.
 */
export function ProfessionalListRow({ professional }: Props) {
  const location = locationLabel(professional);
  const photo =
    professional.imageUrl && professional.imageUrl !== "/placeholder.svg"
      ? professional.imageUrl
      : null;
  const service =
    professional.servicePreviewTitles?.[0]?.trim() ||
    professionalCardBlurb({
      headline: professional.headline,
      shortDescription: professional.shortDescription,
      description: professional.description,
      cardSummary: professional.cardSummary,
      servicePreviewTitles: professional.servicePreviewTitles,
      categoryName: professional.categoryName,
      categorySlug: professional.categorySlug,
      maxChars: 72,
    });
  const initials = professional.displayName.slice(0, 2).toUpperCase();

  return (
    <Link
      href={`/professional/${professional.slug}`}
      className="flex min-h-[4.5rem] items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 transition hover:border-brand-blue/30 hover:shadow-sm sm:gap-3.5 sm:px-3.5"
    >
      <div className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-slate-100 sm:size-16">
        {photo ? (
          <Image
            alt=""
            className="object-cover"
            fill
            sizes="64px"
            src={photo}
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-brand-blue/15 via-white to-brand-green/10">
            <span className="font-[family-name:var(--font-display)] text-sm font-semibold text-slate-400">
              {initials}
            </span>
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[15px] font-semibold leading-snug text-slate-900">
          {professional.displayName}
        </h2>

        {professional.ratingAvg > 0 ? (
          <p className="mt-0.5 inline-flex items-center gap-1 text-sm text-slate-600">
            <Star
              aria-hidden
              className="size-3.5 fill-brand-orange text-brand-orange"
            />
            <span className="tabular-nums font-medium text-slate-800">
              {professional.ratingAvg.toFixed(1)}
            </span>
            {professional.reviewsCount > 0 ? (
              <span className="text-xs text-slate-400">
                · {professional.reviewsCount}
              </span>
            ) : null}
          </p>
        ) : null}

        {service ? (
          <p className="mt-0.5 line-clamp-1 text-sm text-slate-600">{service}</p>
        ) : null}

        {location ? (
          <p className="mt-1 flex min-w-0 items-center gap-1 text-xs text-slate-500">
            <MapPin aria-hidden className="size-3.5 shrink-0 text-slate-400" />
            <span className="truncate">{location}</span>
          </p>
        ) : null}
      </div>
    </Link>
  );
}
