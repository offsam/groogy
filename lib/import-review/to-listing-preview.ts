import type { Listing } from "@/types/listing";
import type { ImportReviewPreviewFields } from "@/lib/import-review/to-business-preview";
import {
  resolveImportDisplayName,
  importCategoryLabel,
} from "@/lib/import-review/display-name";
import type { ImportPreviewKind } from "@/lib/import-review/preview-section";

function first(values: string[] | null | undefined): string | null {
  const v = (values ?? []).map((s) => s.trim()).find(Boolean);
  return v || null;
}

function mediaFromPreview(item: ImportReviewPreviewFields): Listing["media"] {
  const url = item.preview_image_url?.trim();
  if (!url) return [];
  return [
    {
      id: `preview-media-${item.id}`,
      listingId: item.id,
      storagePath: url,
      sortOrder: 0,
      publicUrl: url,
    },
  ];
}

function baseListing(
  item: ImportReviewPreviewFields,
  listingType: Listing["listingType"],
): Listing {
  const resolved = resolveImportDisplayName(item);
  const description =
    item.description?.trim() ||
    item.source_text?.trim() ||
    (item.services ?? []).join(", ") ||
    "";
  const phone = first(item.phone);
  const authorName =
    item.person_name?.trim() ||
    item.source_author_username?.trim() ||
    resolved.name;

  return {
    id: `preview-${item.id}`,
    ownerId: "preview",
    listingType,
    status: "active",
    visibility: "public",
    authorVisibility: "public",
    title: resolved.name,
    description,
    priceAmount: item.price ?? null,
    priceCurrency: (item.currency || "USD").toUpperCase(),
    isNegotiable: item.price == null,
    city: item.city?.trim() || null,
    state: item.state?.trim() || null,
    stateCode: item.state?.trim() || null,
    cityGeoid: null,
    latitude: null,
    longitude: null,
    contactPreference: phone ? "phone" : "any",
    publisherType: "profile",
    publisherBusinessId: null,
    sourceUrl: item.source_url?.trim() || null,
    sourceKind: item.source_url?.trim()
      ? item.source?.toLowerCase().startsWith("facebook")
        ? "facebook"
        : "telegram"
      : null,
    hasSource: Boolean(item.source_url?.trim()),
    publishedAt: new Date().toISOString(),
    reservedAt: null,
    completedAt: null,
    pausedAt: null,
    archivedAt: null,
    expiresAt: null,
    moderationReason: null,
    favoritesCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    media: mediaFromPreview(item),
    author: {
      mode: "public",
      label: authorName,
      avatarUrl: null,
      username: item.telegram_username || item.source_author_username || null,
      profilePath: null,
    },
    publisher: {
      publisherType: "profile",
      businessId: null,
      slug: null,
      name: authorName,
      logoUrl: null,
    },
    favoritedByMe: false,
  };
}

/** Map import-review → Listing shaped for Marketplace / Services / etc. cards. */
export function importReviewToListingPreview(
  item: ImportReviewPreviewFields,
  kind: ImportPreviewKind,
): Listing {
  const categoryLabel = importCategoryLabel(item.category);
  const category = categoryLabel
    ? {
        id: "preview-cat",
        slug: (item.category || "other").toLowerCase(),
        nameRu: categoryLabel,
        nameEn: null,
        sortOrder: 0,
      }
    : null;

  if (kind === "services") {
    const listing = baseListing(item, "service");
    listing.service = {
      serviceCategoryId: null,
      pricingType: item.price != null ? "from" : "contact_for_price",
      priceFrom: item.price ?? null,
      priceTo: null,
      priceUnit: null,
      serviceModes: ["in_person"],
      serviceArea: [item.city, item.state].filter(Boolean).join(", ") || null,
      experienceYears: null,
      languages: ["ru"],
      licenseInfo: null,
      insuranceStatus: null,
      availabilityText: null,
      offersFreeEstimate: false,
      offersEmergencyService: false,
      category,
    };
    return listing;
  }

  if (kind === "lechu") {
    const listing = baseListing(item, "transport_carry");
    listing.lechu = {
      categoryId: null,
      departureCountry: "US",
      destinationCountry: "RU",
      departureDate: null,
      carryTypes: ["documents", "package"],
      maxWeightKg: null,
      sizeLimit: null,
      rewardType: "negotiable",
      category,
    };
    return listing;
  }

  if (kind === "transfers") {
    const listing = baseListing(item, "transfer");
    listing.transfer = {
      categoryId: null,
      fromCountry: "US",
      toCountry: "RU",
      transferMethod: "bank",
      feePercent: null,
      feeFixedUsd: null,
      minAmountUsd: null,
      maxAmountUsd: null,
      processingDays: null,
      category,
    };
    return listing;
  }

  // marketplace / real_estate / jobs / events → marketplace-style card
  const listing = baseListing(
    item,
    kind === "jobs" ? "job" : "marketplace_item",
  );
  listing.marketplace = {
    categoryId: null,
    condition: null,
    transactionType: kind === "jobs" ? "wanted" : "sell",
    deliveryAvailable: false,
    pickupAvailable: true,
    quantity: null,
    category,
  };
  return listing;
}
