import type { SupabaseClient } from "@supabase/supabase-js";

export type BusinessEmployeeTeaser = {
  id: string;
  slug: string;
  displayName: string;
  headline: string | null;
  employerRole: string | null;
  imageUrl: string | null;
  city: string | null;
};

/** Approved professionals linked to this business via employer_business_id. */
export async function listEmployeesForBusiness(
  client: SupabaseClient,
  businessId: string,
  limit = 48,
): Promise<BusinessEmployeeTeaser[]> {
  const { data, error } = await client
    .from("professionals")
    .select(
      "id, slug, display_name, headline, employer_role, image_url, city, status",
    )
    .eq("employer_business_id", businessId)
    .eq("status", "approved")
    .order("display_name", { ascending: true })
    .limit(limit);
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    slug: String(row.slug || ""),
    displayName: String(row.display_name || "").trim() || "Специалист",
    headline: row.headline ? String(row.headline) : null,
    employerRole: row.employer_role ? String(row.employer_role) : null,
    imageUrl: row.image_url ? String(row.image_url) : null,
    city: row.city ? String(row.city) : null,
  }));
}
