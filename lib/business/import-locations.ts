import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExtractedUsStreetAddress } from "@/lib/admin/paste-enrich";

function untyped(client: SupabaseClient) {
  return client as unknown as SupabaseClient;
}

function locationKey(row: {
  address_line?: string | null;
  city?: string | null;
  state_code?: string | null;
}): string {
  return [
    row.address_line || "",
    row.city || "",
    (row.state_code || "").replace(/^US-/, ""),
  ]
    .join("|")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}|]+/gu, " ")
    .trim();
}

function toStateCode(state: string | null | undefined): string | null {
  const s = (state || "").trim().toUpperCase().replace(/^US-/, "");
  if (!s) return null;
  return s.length === 2 ? `US-${s}` : s;
}

/**
 * Insert street addresses the business does not have yet.
 * First new row becomes primary only when the business has none.
 */
export async function addMissingBusinessLocations(
  client: SupabaseClient,
  businessId: string,
  addresses: ExtractedUsStreetAddress[],
  opts?: { source?: string; sourceUrl?: string | null },
): Promise<number> {
  if (!addresses.length) return 0;
  const db = untyped(client);
  const { data: existingRows } = await db
    .from("business_locations")
    .select("id, address_line, city, state_code, is_primary, sort_order, status")
    .eq("business_id", businessId)
    .neq("status", "archived");

  const existing = (existingRows ?? []) as Array<{
    id: string;
    address_line: string | null;
    city: string | null;
    state_code: string | null;
    is_primary: boolean | null;
    sort_order: number | null;
    status: string | null;
  }>;
  const taken = new Set(existing.map((row) => locationKey(row)));
  const hasPrimary = existing.some(
    (row) => row.is_primary && row.status === "published",
  );
  let sort = existing.reduce(
    (max, row) => Math.max(max, Number(row.sort_order ?? 0)),
    0,
  );
  let added = 0;

  for (const addr of addresses) {
    const street = addr.addressLine?.trim();
    if (!street) continue;
    const stateCode = toStateCode(addr.state);
    const key = locationKey({
      address_line: street,
      city: addr.city,
      state_code: stateCode,
    });
    if (!key || taken.has(key)) continue;
    taken.add(key);
    sort += 10;
    const makePrimary = !hasPrimary && added === 0;
    const { error } = await db.from("business_locations").insert({
      business_id: businessId,
      label: addr.label?.trim().slice(0, 80) || addr.city || null,
      kind: "street",
      address_line: street.slice(0, 160),
      city: addr.city?.slice(0, 80) || null,
      region: addr.state?.replace(/^US-/, "") || null,
      state_code: stateCode,
      postal_code: addr.postalCode || null,
      location_precision: "street",
      is_primary: makePrimary,
      sort_order: sort,
      source: opts?.source ?? "enrich_description",
      source_url: opts?.sourceUrl ?? null,
      status: "published",
    });
    if (!error) added += 1;
  }
  return added;
}
