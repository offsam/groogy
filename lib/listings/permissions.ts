import type { Listing, ListingStatus, ListingType } from "@/types/listing";
import { canUserTransition } from "@/lib/listings/validation";

export function isListingOwner(listing: Pick<Listing, "ownerId">, userId: string | null) {
  return Boolean(userId && listing.ownerId === userId);
}

export function canEditListing(
  listing: Pick<Listing, "ownerId" | "status">,
  userId: string | null,
  isAdmin = false,
) {
  if (isAdmin) return true;
  if (!isListingOwner(listing, userId)) return false;
  return !["removed", "rejected"].includes(listing.status);
}

export function canChangeStatus(
  listing: Pick<Listing, "ownerId" | "status" | "listingType">,
  userId: string | null,
  next: ListingStatus,
) {
  if (!isListingOwner(listing, userId)) return false;
  return canUserTransition(
    listing.status,
    next,
    listing.listingType ?? ("marketplace_item" as ListingType),
  );
}

export function isPubliclyIndexable(
  listing: Pick<Listing, "status" | "visibility">,
) {
  return listing.status === "active" && listing.visibility === "public";
}
