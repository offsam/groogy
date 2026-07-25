import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ListingMedia } from "@/types/listing";
import { LISTING_IMAGES_BUCKET } from "@/lib/listings/constants";

type Client = SupabaseClient<Database>;

const SIGNED_URL_TTL_SEC = 60 * 60; // 1 hour

/** Create signed URLs for private listing-images bucket (RLS-gated). */
export async function signListingMediaUrls(
  client: Client,
  media: { id: string; listingId: string; storagePath: string; sortOrder: number }[],
): Promise<ListingMedia[]> {
  if (media.length === 0) return [];

  const signed = await Promise.all(
    media.map(async (item) => {
      const { data, error } = await client.storage
        .from(LISTING_IMAGES_BUCKET)
        .createSignedUrl(item.storagePath, SIGNED_URL_TTL_SEC);

      return {
        id: item.id,
        listingId: item.listingId,
        storagePath: item.storagePath,
        sortOrder: item.sortOrder,
        publicUrl: error || !data?.signedUrl ? null : data.signedUrl,
      } satisfies ListingMedia;
    }),
  );

  return signed;
}

export function redactOwnerId(
  listing: { ownerId: string },
  viewerId: string | null,
  isAdmin = false,
): string {
  if (isAdmin || (viewerId && viewerId === listing.ownerId)) {
    return listing.ownerId;
  }
  return "";
}
