import Image from "next/image";
import Link from "next/link";
import { Briefcase, Building2, MapPin, Star } from "lucide-react";
import { GoogleIcon } from "@/components/brand/BrandIcons";
import { normalizeUsZip } from "@/lib/brand";
import type { Professional } from "@/types/professional";

type Props = {
  professional: Professional;
};

function formatLocationParts(
  street: string | null,
  city: string | null,
  zip: string | null,
): string | null {
  if (street && city && zip) return `${street}, ${city}, ${zip}`;
  if (street && city) return `${street}, ${city}`;
  if (city && zip) return `${city}, ${zip}`;
  if (city) return city;
  if (street) return street;
  if (zip) return zip;
  return null;
}

function employerLocationLabel(professional: Professional): string | null {
  const fromBusiness = formatLocationParts(
    professional.employerBusinessAddressLine?.trim() || null,
    professional.employerBusinessCity?.trim() || null,
    professional.employerBusinessPostalCode
      ? normalizeUsZip(professional.employerBusinessPostalCode)
      : null,
  );
  if (fromBusiness) return fromBusiness;
  // Free-text employer (no catalog link): show the specialist's own address.
  return formatLocationParts(
    professional.addressLine?.trim() || null,
    professional.city?.trim() || null,
    professional.postalCode ? normalizeUsZip(professional.postalCode) : null,
  );
}

/** Highlighted company the specialist works at (not necessarily owns). */
export function ProfessionalWorkplaceCard({ professional }: Props) {
  const companyName =
    professional.employerName?.trim() ||
    professional.employerBusinessName?.trim() ||
    null;
  if (!companyName) return null;

  const role = professional.employerRole?.trim() || null;
  const href = professional.employerBusinessSlug
    ? `/business/${professional.employerBusinessSlug}`
    : null;
  const logo =
    professional.employerBusinessImageUrl &&
    professional.employerBusinessImageUrl !== "/placeholder.svg"
      ? professional.employerBusinessImageUrl
      : null;
  const location = employerLocationLabel(professional);
  const googleRating =
    professional.employerBusinessGoogleRating != null
      ? Number(professional.employerBusinessGoogleRating)
      : null;
  const googleReviews =
    professional.employerBusinessGoogleReviewsCount != null
      ? Number(professional.employerBusinessGoogleReviewsCount)
      : 0;
  const showGoogle =
    googleRating != null &&
    Number.isFinite(googleRating) &&
    googleRating > 0;

  const body = (
    <div className="flex gap-3.5 sm:gap-4">
      <div className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white text-slate-500 ring-1 ring-black/5 sm:size-16">
        {logo ? (
          <Image
            alt=""
            className="object-cover"
            fill
            sizes="64px"
            src={logo}
            unoptimized
          />
        ) : (
          <Building2 aria-hidden className="size-6 text-brand-blue" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md bg-brand-blue/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-blue-deep">
            <Building2 aria-hidden className="size-3" />
            Компания
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Работает в
          </span>
        </div>
        <p className="text-lg font-semibold leading-snug tracking-tight text-slate-900 sm:text-xl">
          {href ? (
            <span className="group-hover:text-brand-blue group-hover:underline">
              {companyName}
            </span>
          ) : (
            companyName
          )}
        </p>
        {role ? (
          <p className="flex items-center gap-1.5 text-sm text-slate-600">
            <Briefcase
              aria-hidden
              className="size-3.5 shrink-0 text-slate-400"
            />
            <span className="truncate">{role}</span>
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            Сотрудник компании · не владелец карточки бизнеса
          </p>
        )}
        {location ? (
          <p className="flex items-start gap-1.5 text-sm text-slate-600">
            <MapPin
              aria-hidden
              className="mt-0.5 size-3.5 shrink-0 text-brand-green"
            />
            <span>{location}</span>
          </p>
        ) : null}
        {showGoogle ? (
          <p className="inline-flex flex-wrap items-center gap-1.5 rounded-lg bg-white/80 px-2 py-1 text-sm font-semibold text-slate-800 ring-1 ring-black/5">
            <GoogleIcon className="size-3.5 shrink-0" />
            <span className="inline-flex items-center gap-1">
              <Star
                aria-hidden
                className="size-3.5 fill-amber-400 text-amber-400"
              />
              {googleRating!.toFixed(1)}
            </span>
            {googleReviews > 0 ? (
              <span className="font-normal text-slate-500">
                · {googleReviews} на Google
              </span>
            ) : (
              <span className="font-normal text-slate-500">Google</span>
            )}
          </p>
        ) : null}
      </div>
    </div>
  );

  const shellClass =
    "block rounded-2xl border border-brand-blue/20 bg-gradient-to-br from-brand-blue/[0.07] via-white to-brand-green/[0.06] p-4 shadow-[0_2px_12px_rgba(15,23,42,0.04)] sm:p-5";

  if (href) {
    return (
      <Link
        className={`group ${shellClass} transition hover:border-brand-blue/40 hover:shadow-sm`}
        href={href}
      >
        {body}
      </Link>
    );
  }

  return <div className={shellClass}>{body}</div>;
}
