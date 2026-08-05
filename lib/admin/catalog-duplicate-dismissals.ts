/**
 * Persist «не двойник» for catalog duplicate pairs (admin).
 * Pair order is canonical so (A,B) and (B,A) share one row.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type CatalogDismissEntityKind =
  | "business"
  | "professional"
  | "event"
  | "job"
  | "service"
  | "transfer"
  | "marketplace"
  | "lechu";

export type CatalogDismissSide = {
  kind: CatalogDismissEntityKind | string;
  id: string;
};

function normalizeKind(kind: string): CatalogDismissEntityKind | null {
  const k = (kind || "").trim().toLowerCase();
  if (
    k === "business" ||
    k === "professional" ||
    k === "event" ||
    k === "job" ||
    k === "service" ||
    k === "transfer" ||
    k === "marketplace" ||
    k === "lechu"
  ) {
    return k;
  }
  return null;
}

/** Stable key for Set lookups / Map filters. */
export function catalogDismissPairKey(
  a: CatalogDismissSide,
  b: CatalogDismissSide,
): string | null {
  const ak = normalizeKind(String(a.kind));
  const bk = normalizeKind(String(b.kind));
  const aId = String(a.id || "").trim();
  const bId = String(b.id || "").trim();
  if (!ak || !bk || !aId || !bId || aId === bId) return null;
  const left =
    ak < bk || (ak === bk && aId < bId)
      ? { kind: ak, id: aId }
      : { kind: bk, id: bId };
  const right =
    left.kind === ak && left.id === aId
      ? { kind: bk, id: bId }
      : { kind: ak, id: aId };
  return `${left.kind}:${left.id}|${right.kind}:${right.id}`;
}

export function canonicalDismissSides(
  a: CatalogDismissSide,
  b: CatalogDismissSide,
): {
  left_kind: CatalogDismissEntityKind;
  left_id: string;
  right_kind: CatalogDismissEntityKind;
  right_id: string;
} | null {
  const key = catalogDismissPairKey(a, b);
  if (!key) return null;
  const [left, right] = key.split("|");
  const [left_kind, left_id] = left.split(":") as [
    CatalogDismissEntityKind,
    string,
  ];
  const [right_kind, right_id] = right.split(":") as [
    CatalogDismissEntityKind,
    string,
  ];
  return { left_kind, left_id, right_kind, right_id };
}

export async function loadCatalogDismissPairKeys(
  catalog: SupabaseClient,
): Promise<Set<string>> {
  const out = new Set<string>();
  const page = 1000;
  let offset = 0;
  for (;;) {
    const { data, error } = await catalog
      .from("catalog_duplicate_dismissals")
      .select("left_kind, left_id, right_kind, right_id")
      .order("created_at", { ascending: true })
      .range(offset, offset + page - 1);
    if (error) {
      // Table missing in older envs — treat as empty.
      if (/does not exist|schema cache/i.test(error.message)) return out;
      throw new Error(error.message);
    }
    const rows = (data ?? []) as Array<{
      left_kind: string;
      left_id: string;
      right_kind: string;
      right_id: string;
    }>;
    for (const row of rows) {
      out.add(
        `${row.left_kind}:${row.left_id}|${row.right_kind}:${row.right_id}`,
      );
    }
    if (rows.length < page) break;
    offset += page;
  }
  return out;
}

export function isCatalogPairDismissed(
  dismissed: Set<string>,
  a: CatalogDismissSide,
  b: CatalogDismissSide,
): boolean {
  const key = catalogDismissPairKey(a, b);
  return Boolean(key && dismissed.has(key));
}
