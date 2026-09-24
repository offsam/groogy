import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ProfileSkillFrame } from "@/types/profile-cabinet";

type Client = SupabaseClient<Database>;

function untyped(client: Client) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new tables lag Database types
  return client as unknown as import("@supabase/supabase-js").SupabaseClient<any>;
}

type SkillFrameRow = {
  id: string;
  user_id: string;
  title: string;
  skills: string;
  workplace: string | null;
  specialty: string | null;
  show_public: boolean;
  is_active: boolean;
  listing_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  listings?: { status: string } | { status: string }[] | null;
};

function mapSkillFrame(row: SkillFrameRow): ProfileSkillFrame {
  const listingRaw = row.listings;
  const listing = Array.isArray(listingRaw) ? listingRaw[0] : listingRaw;
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title ?? "",
    skills: row.skills ?? "",
    workplace: row.workplace,
    specialty: row.specialty,
    showPublic: Boolean(row.show_public),
    isActive: Boolean(row.is_active) || listing?.status === "active",
    listingId: row.listing_id,
    listingStatus: listing?.status ?? null,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listSkillFramesForOwner(
  client: Client,
  userId: string,
): Promise<ProfileSkillFrame[]> {
  const { data, error } = await untyped(client)
    .from("profile_skill_frames")
    .select(
      "id, user_id, title, skills, workplace, specialty, show_public, is_active, listing_id, sort_order, created_at, updated_at, listings(status)",
    )
    .eq("user_id", userId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("[skill-frames] list failed:", error.message);
    return [];
  }
  return ((data ?? []) as SkillFrameRow[]).map(mapSkillFrame);
}

export async function listPublicSkillFrames(
  client: Client,
  userId: string,
): Promise<ProfileSkillFrame[]> {
  const { data, error } = await untyped(client)
    .from("profile_skill_frames")
    .select(
      "id, user_id, title, skills, workplace, specialty, show_public, is_active, listing_id, sort_order, created_at, updated_at, listings(status)",
    )
    .eq("user_id", userId)
    .eq("show_public", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("[skill-frames] public list failed:", error.message);
    return [];
  }
  return ((data ?? []) as SkillFrameRow[]).map(mapSkillFrame);
}
