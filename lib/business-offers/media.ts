import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { BusinessOfferMedia } from "@/types/business-offer";
import { LISTING_IMAGES_BUCKET } from "@/lib/listings/constants";

type Client = SupabaseClient<Database>;

const SIGNED_URL_TTL_SEC = 60 * 60;

export function offerStoragePrefix(businessId: string, offerId: string): string {
  return `business-offers/${businessId}/${offerId}/`;
}

export async function signOfferMediaUrls(
  client: Client,
  media: {
    id: string;
    offerId: string;
    storagePath: string;
    sortOrder: number;
    altText: string | null;
  }[],
): Promise<BusinessOfferMedia[]> {
  if (media.length === 0) return [];

  return Promise.all(
    media.map(async (item) => {
      const { data, error } = await client.storage
        .from(LISTING_IMAGES_BUCKET)
        .createSignedUrl(item.storagePath, SIGNED_URL_TTL_SEC);

      return {
        id: item.id,
        offerId: item.offerId,
        storagePath: item.storagePath,
        sortOrder: item.sortOrder,
        altText: item.altText,
        publicUrl: error || !data?.signedUrl ? null : data.signedUrl,
      };
    }),
  );
}

export const MAX_OFFER_MEDIA = 10;
