"use client";

import type { ReactNode } from "react";
import { BusinessCard } from "@/components/business/BusinessCard";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { ServiceCard } from "@/components/services/ServiceCard";
import { LechuCard } from "@/components/lechu/LechuCard";
import { TransferCard } from "@/components/transfers/TransferCard";
import { ProfessionalCard } from "@/components/professional/ProfessionalCard";
import {
  importReviewItemToPreviewFields,
  importReviewToBusinessPreview,
  importReviewToProfessionalPreview,
  type ImportReviewPreviewFields,
} from "@/lib/import-review/to-business-preview";
import { importReviewToListingPreview } from "@/lib/import-review/to-listing-preview";
import {
  IMPORT_PREVIEW_KIND_HINTS,
  IMPORT_PREVIEW_KIND_LABELS,
  resolveImportPreviewKind,
  type ImportPreviewKind,
} from "@/lib/import-review/preview-section";
import type { ImportReviewItem } from "@/types/import-review";
import { cn } from "@/lib/utils";

type PreviewSource =
  | ImportReviewItem
  | (ImportReviewPreviewFields & {
      entity_type?: string | null;
      target_collection?: string | null;
    });

type Props = {
  item: PreviewSource;
  /** Show section chip above the card. */
  showSectionBadge?: boolean;
  className?: string;
};

function fieldsFrom(item: PreviewSource): ImportReviewPreviewFields & {
  entity_type?: string | null;
  target_collection?: string | null;
} {
  if ("source_fingerprint" in item) {
    return {
      ...importReviewItemToPreviewFields(item),
      entity_type: item.entity_type,
      target_collection: item.target_collection,
    };
  }
  return item;
}

function SectionBadge({ kind }: { kind: ImportPreviewKind }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <span className="rounded-md border border-brand-blue/20 bg-brand-blue/5 px-2 py-0.5 text-[11px] font-semibold text-brand-blue-deep">
        {IMPORT_PREVIEW_KIND_LABELS[kind]}
      </span>
      <span className="text-[11px] text-slate-500">
        {IMPORT_PREVIEW_KIND_HINTS[kind]}
      </span>
    </div>
  );
}

/** Jobs/events without a dedicated public card — marketplace-like shell. */
function GenericSectionCard({
  title,
  description,
  price,
  currency,
  city,
  state,
  imageUrl,
  kind,
}: {
  title: string;
  description: string;
  price: number | null;
  currency: string;
  city: string | null;
  state: string | null;
  imageUrl: string | null;
  kind: ImportPreviewKind;
}) {
  const location = [city, state].filter(Boolean).join(", ");
  const priceLabel =
    price != null
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: currency || "USD",
          maximumFractionDigits: 0,
        }).format(price)
      : null;

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="relative aspect-[4/3] bg-slate-100">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            className="h-full w-full object-cover"
            src={imageUrl}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900 px-4 text-center text-sm font-semibold uppercase tracking-wide text-white">
            {IMPORT_PREVIEW_KIND_LABELS[kind]}
          </div>
        )}
      </div>
      <div className="space-y-1.5 p-4">
        <h3 className="line-clamp-2 font-semibold text-slate-900">{title}</h3>
        {priceLabel ? (
          <p className="text-lg font-bold text-slate-900">{priceLabel}</p>
        ) : null}
        {description ? (
          <p className="line-clamp-2 text-sm text-slate-600">{description}</p>
        ) : null}
        {location ? (
          <p className="text-xs text-slate-500">{location}</p>
        ) : null}
      </div>
    </article>
  );
}

export function ImportReviewTypedCard({
  item,
  showSectionBadge = true,
  className,
}: Props) {
  const fields = fieldsFrom(item);
  const kind = resolveImportPreviewKind(fields);

  let card: ReactNode;
  if (kind === "business") {
    card = (
      <BusinessCard business={importReviewToBusinessPreview(fields)} preview />
    );
  } else if (kind === "professional") {
    card = (
      <ProfessionalCard
        professional={importReviewToProfessionalPreview(fields)}
        preview
      />
    );
  } else if (kind === "services") {
    card = (
      <ServiceCard
        listing={importReviewToListingPreview(fields, kind)}
        preview
      />
    );
  } else if (kind === "lechu") {
    card = (
      <LechuCard listing={importReviewToListingPreview(fields, kind)} preview />
    );
  } else if (kind === "transfers") {
    card = (
      <TransferCard
        listing={importReviewToListingPreview(fields, kind)}
        preview
      />
    );
  } else if (kind === "marketplace" || kind === "real_estate") {
    card = (
      <ListingCard
        listing={importReviewToListingPreview(fields, kind)}
        preview
      />
    );
  } else {
    const listing = importReviewToListingPreview(fields, kind);
    card = (
      <GenericSectionCard
        city={listing.city}
        currency={listing.priceCurrency}
        description={listing.description}
        imageUrl={listing.media?.[0]?.publicUrl ?? null}
        kind={kind}
        price={listing.priceAmount}
        state={listing.state}
        title={listing.title}
      />
    );
  }

  return (
    <div className={cn(className)}>
      {showSectionBadge ? <SectionBadge kind={kind} /> : null}
      {card}
    </div>
  );
}
