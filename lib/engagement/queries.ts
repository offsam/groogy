import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { EntityEngagement } from "@/types/engagement";

type Client = SupabaseClient<Database>;

function untyped(client: Client): SupabaseClient {
  return client as unknown as SupabaseClient;
}

export async function getBusinessEngagement(
  client: Client,
  businessId: string,
  userId: string | null,
  counts: { likesCount: number; followersCount: number },
): Promise<EntityEngagement> {
  if (!userId) {
    return {
      likesCount: counts.likesCount,
      followersCount: counts.followersCount,
      likedByMe: false,
      followedByMe: false,
    };
  }

  const db = untyped(client);
  const [likeRes, followRes] = await Promise.all([
    db
      .from("business_likes")
      .select("business_id")
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("business_followers")
      .select("business_id")
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  return {
    likesCount: counts.likesCount,
    followersCount: counts.followersCount,
    likedByMe: Boolean(likeRes.data),
    followedByMe: Boolean(followRes.data),
  };
}

export async function getProfessionalEngagement(
  client: Client,
  professionalId: string,
  userId: string | null,
  counts: { likesCount: number; followersCount: number },
): Promise<EntityEngagement> {
  if (!userId) {
    return {
      likesCount: counts.likesCount,
      followersCount: counts.followersCount,
      likedByMe: false,
      followedByMe: false,
    };
  }

  const db = untyped(client);
  const [likeRes, followRes] = await Promise.all([
    db
      .from("professional_likes")
      .select("professional_id")
      .eq("professional_id", professionalId)
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("professional_followers")
      .select("professional_id")
      .eq("professional_id", professionalId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  return {
    likesCount: counts.likesCount,
    followersCount: counts.followersCount,
    likedByMe: Boolean(likeRes.data),
    followedByMe: Boolean(followRes.data),
  };
}
