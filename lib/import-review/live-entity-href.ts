import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Public profile URL for a live catalog entity (admin lens / sources land here).
 */
export async function liveEntityHref(
  client: SupabaseClient,
  entityType: string | null | undefined,
  entityId: string | null | undefined,
): Promise<string | null> {
  const id = String(entityId || "").trim();
  const type = String(entityType || "").trim();
  if (!id || !type) return null;

  const db = client as SupabaseClient;
  if (type === "business" || type === "organization" || type === "service") {
    const { data } = await db
      .from("businesses")
      .select("slug")
      .eq("id", id)
      .maybeSingle();
    const slug = (data as { slug?: string } | null)?.slug;
    return slug ? `/business/${slug}` : null;
  }
  if (type === "professional" || type === "private_specialist") {
    const { data } = await db
      .from("professionals")
      .select("slug")
      .eq("id", id)
      .maybeSingle();
    const slug = (data as { slug?: string } | null)?.slug;
    return slug ? `/professional/${slug}` : null;
  }
  return null;
}
