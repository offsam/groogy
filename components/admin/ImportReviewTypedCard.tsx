"use client";

import type { ReactNode } from "react";
import { BusinessCard } from "@/components/business/BusinessCard";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { ServiceCard } from "@/components/services/ServiceCard";
import { LechuCard } from "@/components/lechu/LechuCard";
import { TransferCard } from "@/components/transfers/TransferCard";
import { ProfessionalCard } from "@/components/professional/ProfessionalCard";
import { EventCard } from "@/components/events/EventCard";
import { JobCard } from "@/components/jobs/JobCard";
import {
  RealEstateCard,
  type RealEstateCardItem,
} from "@/components/real-estate/RealEstateCard";
import {
  importReviewItemToPreviewFields,
  importReviewToBusinessPreview,
  importReviewToEventPreview,
  importReviewToJobPreview,
  importReviewToProfessionalPreview,
  type ImportReviewPreviewFields,
} from "@/lib/import-review/to-business-preview";
import { importReviewToListingPreview } from "@/lib/import-review/to-listing-preview";
import { resolveImportPreviewKind } from "@/lib/import-review/preview-section";
import { PreviewSectionBadge } from "@/components/admin/PreviewSectionBadge";
import type { ImportReviewItem } from "@/types/import-review";
import type { Listing } from "@/types/listing";
import { cn } from "@/lib/utils";

function listingToRealEstateCardItem(listing: Listing): RealEstateCardItem {
  return {
    id: listing.id,
    title: listing.title,
    slug: listing.id,
    city: listing.city,
    priceAmount: listing.priceAmount,
    priceCurrency: listing.priceCurrency,
    offerKind:
      (listing.marketplace?.transactionType as string | undefined) === "rent"
        ? "rent"
        : "sell",
    coverUrl: listing.media?.[0]?.publicUrl ?? null,
    paymentMethods: listing.paymentMethods ?? null,
  };
}

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
  } else if (kind === "marketplace") {
    card = (
      <ListingCard
        listing={importReviewToListingPreview(fields, kind)}
        preview
      />
    );
  } else if (kind === "real_estate") {
    card = (
      <RealEstateCard
        item={listingToRealEstateCardItem(
          importReviewToListingPreview(fields, kind),
        )}
        preview
      />
    );
  } else if (kind === "events") {
    card = <EventCard event={importReviewToEventPreview(fields)} preview />;
  } else {
    card = <JobCard job={importReviewToJobPreview(fields)} preview />;
  }

  return (
    <div className={cn("min-w-0 w-full overflow-hidden", className)}>
      {showSectionBadge ? <PreviewSectionBadge kind={kind} /> : null}
      <div className="min-w-0 max-w-full overflow-hidden">{card}</div>
    </div>
  );
}
