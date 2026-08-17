"use client";

import Image from "next/image";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { normalizeUsZip } from "@/lib/brand";
import { resolvePublicCityPostal } from "@/lib/address/normalize";
import { redactContactsFromPublicText } from "@/lib/content/structure-business-profile";
import type { Church } from "@/types/church";

type ChurchCardProps = {
  church: Church;
  preview?: boolean;
};

export function churchCardLocationLabel(church: Church): string | null {
  const { city, postalCode } = resolvePublicCityPostal({
    city: church.city,
    region: church.region,
    stateCode: church.stateCode,
    postalCode: church.postalCode,
    shortDescription: null,
    description: church.description,
  });
  const zip = postalCode ? normalizeUsZip(postalCode) : null;
  if (city && zip) return `${city}, ${zip}`;
  if (city) return city;
  if (zip) return zip;
  return null;
}

export function ChurchCard({ church, preview = false }: ChurchCardProps) {
  const location = churchCardLocationLabel(church);
  const photo =
    church.imageUrl && church.imageUrl !== "/placeholder.svg"
      ? church.imageUrl
      : null;
  const blurb = redactContactsFromPublicText(church.description);

  const body = (
    <>
      <div className="relative aspect-[4/3] shrink-0 bg-slate-100">
        {photo ? (
          <Image
            alt={church.name}
            className="object-cover"
            fill
            sizes="(max-width: 640px) 100vw, 33vw"
            src={photo}
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-brand-blue/15 via-white to-brand-green/10">
            <span className="font-[family-name:var(--font-display)] text-3xl font-semibold text-slate-400">
              {church.name.slice(0, 2).toUpperCase()}
            </span>
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-3.5 sm:p-4">
        <h2 className="truncate text-[15px] font-semibold text-slate-900">
          {church.name}
        </h2>
        {blurb ? (
          <p className="line-clamp-2 text-sm leading-snug text-slate-600">
            {blurb}
          </p>
        ) : null}
        {location ? (
          <p className="mt-auto flex items-center gap-1 truncate text-xs text-slate-500">
            <MapPin aria-hidden className="size-3 shrink-0" />
            <span className="truncate">{location}</span>
          </p>
        ) : null}
      </div>
    </>
  );

  if (preview) {
    return (
      <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {body}
      </article>
    );
  }

  return (
    <Link
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition-shadow hover:shadow-md"
      href={`/churches/${church.slug}`}
    >
      {body}
    </Link>
  );
}
