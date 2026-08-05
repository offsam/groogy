import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isPubliclyListedStatus } from "@/lib/import-review/merge-contract";

/**
 * Public profile URL for a live catalog entity (R16).
 * Pending/archived are admin-only — never return a public path (404 trap).
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
      .select("slug, status")
      .eq("id", id)
      .maybeSingle();
    const row = data as { slug?: string; status?: string } | null;
    if (!row?.slug || !isPubliclyListedStatus(row.status)) return null;
    return `/business/${row.slug}`;
  }
  if (type === "professional" || type === "private_specialist") {
    const { data } = await db
      .from("professionals")
      .select("slug, status")
      .eq("id", id)
      .maybeSingle();
    const row = data as { slug?: string; status?: string } | null;
    if (!row?.slug || !isPubliclyListedStatus(row.status)) return null;
    return `/professional/${row.slug}`;
  }
  return null;
}
