"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  slugifyUsernameBase,
  usernameCandidate,
} from "@/lib/profile/username";

type Client = SupabaseClient<Database>;

/**
 * Ensure the profile has a username. Allocates from display name / email if missing.
 * Returns the username or null if update failed.
 */
export async function ensureProfileUsername(
  client: Client,
  userId: string,
  opts: { displayName?: string | null; email?: string | null } = {},
): Promise<string | null> {
  const { data: row, error } = await client
    .from("profiles")
    .select("username, display_name")
    .eq("id", userId)
    .maybeSingle();

  if (error || !row) return null;
  if (row.username) return row.username;

  const base = slugifyUsernameBase(
    row.display_name || opts.displayName || opts.email?.split("@")[0] || "user",
  );

  for (let n = 0; n <= 9999; n++) {
    const candidate = usernameCandidate(base, n);
    const { error: updError } = await client
      .from("profiles")
      .update({ username: candidate })
      .eq("id", userId)
      .is("username", null);

    if (!updError) {
      const { data: again } = await client
        .from("profiles")
        .select("username")
        .eq("id", userId)
        .maybeSingle();
      return again?.username ?? candidate;
    }
    if (updError.code !== "23505") {
      // Race: another request filled username
      const { data: again } = await client
        .from("profiles")
        .select("username")
        .eq("id", userId)
        .maybeSingle();
      if (again?.username) return again.username;
      return null;
    }
  }
  return null;
}
