import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExtractedUsStreetAddress } from "@/lib/admin/paste-enrich";
import { isSamePhysicalStreetPlace } from "@/lib/business/location-same-place";

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
 * Near-duplicate typos of an existing office update that row instead of
 * creating a second pin («Indusrtial» → «Industrial»).
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
    .select(
      "id, address_line, city, state_code, postal_code, is_primary, sort_order, status",
    )
    .eq("business_id", businessId)
    .neq("status", "archived");

  const existing = (existingRows ?? []) as Array<{
    id: string;
    address_line: string | null;
    city: string | null;
    state_code: string | null;
    postal_code: string | null;
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

    const twin = existing.find((row) =>
      isSamePhysicalStreetPlace(row, {
        addressLine: street,
        city: addr.city,
        state: addr.state,
        postalCode: addr.postalCode,
      }),
    );
    if (twin) {
      const patch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (
        street &&
        street.toLowerCase() !== (twin.address_line || "").toLowerCase()
      ) {
        patch.address_line = street.slice(0, 160);
        twin.address_line = street.slice(0, 160);
      }
      if (addr.city?.trim() && !twin.city?.trim()) {
        patch.city = addr.city.slice(0, 80);
        twin.city = addr.city.slice(0, 80);
      }
      if (stateCode && !twin.state_code?.trim()) {
        patch.state_code = stateCode;
        twin.state_code = stateCode;
      }
      if (addr.postalCode?.trim() && !twin.postal_code?.trim()) {
        patch.postal_code = addr.postalCode;
        twin.postal_code = addr.postalCode;
      }
      if (Object.keys(patch).length > 1) {
        await db.from("business_locations").update(patch).eq("id", twin.id);
      }
      taken.add(key);
      continue;
    }

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
    if (!error) {
      added += 1;
      existing.push({
        id: "new",
        address_line: street.slice(0, 160),
        city: addr.city?.slice(0, 80) || null,
        state_code: stateCode,
        postal_code: addr.postalCode || null,
        is_primary: makePrimary,
        sort_order: sort,
        status: "published",
      });
    }
  }
  return added;
}
