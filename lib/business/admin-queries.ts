import type { SupabaseClient } from "@supabase/supabase-js";

export type AdminBusinessRow = {
  id: string;
  slug: string;
  name: string;
  status: "draft" | "pending" | "approved" | "rejected" | "archived";
  phone: string | null;
  website: string | null;
  city: string | null;
  address_line: string | null;
  latitude: number | null;
  longitude: number | null;
  image_url: string | null;
  short_description: string | null;
  created_at: string;
  offers_count: number;
};

export type DuplicateReason = "phone" | "name";

export type DuplicatePair = {
  id: string;
  reason: DuplicateReason;
  reasonLabel: string;
  a: AdminBusinessRow;
  b: AdminBusinessRow;
};

const ADMIN_BUSINESS_SELECT = `
  id,
  slug,
  name,
  status,
  phone,
  website,
  city,
  address_line,
  latitude,
  longitude,
  image_url,
  short_description,
  created_at
`;

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length >= 10 ? digits : null;
}

export function normalizeBusinessName(name: string | null | undefined): string {
  if (!name) return "";
  let n = name.toLowerCase();
  n = n.replace(/[^a-z0-9а-яё]+/gi, " ");
  for (const w of [
    "inc",
    "llc",
    "law",
    "pc",
    "the",
    "realtor",
    "fitness trainer",
    "hair salon",
    "cleaning services",
    "homemade food delivery",
    "immigration attorney",
    "real estate agent",
  ]) {
    n = n.replace(new RegExp(`\\b${w}\\b`, "g"), " ");
  }
  return n.replace(/\s+/g, " ").trim();
}

function preferCanonical(a: AdminBusinessRow, b: AdminBusinessRow): [AdminBusinessRow, AdminBusinessRow] {
  const score = (row: AdminBusinessRow) => {
    let s = 0;
    if (row.slug.startsWith("consolidated-")) s += 30;
    else if (row.slug.startsWith("enriched-")) s += 20;
    else if (row.slug.startsWith("fb-post-")) s += 10;
    if (row.status === "approved") s += 15;
    else if (row.status === "pending") s += 5;
    s += Math.min(row.offers_count, 20);
    if (row.phone) s += 2;
    if (row.address_line) s += 2;
    if (row.latitude != null) s += 2;
    return s;
  };
  return score(a) >= score(b) ? [a, b] : [b, a];
}

export function findDuplicatePairs(rows: AdminBusinessRow[]): DuplicatePair[] {
  const byPhone = new Map<string, AdminBusinessRow[]>();
  const byName = new Map<string, AdminBusinessRow[]>();

  for (const row of rows) {
    if (row.status === "archived") continue;
    const phone = normalizePhone(row.phone);
    if (phone) {
      const list = byPhone.get(phone) ?? [];
      list.push(row);
      byPhone.set(phone, list);
    }
    const name = normalizeBusinessName(row.name);
    if (name.length >= 4) {
      const list = byName.get(name) ?? [];
      list.push(row);
      byName.set(name, list);
    }
  }

  const seen = new Set<string>();
  const pairs: DuplicatePair[] = [];

  function addPair(reason: DuplicateReason, items: AdminBusinessRow[], label: string) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const [keep, drop] = preferCanonical(items[i], items[j]);
        const key = [keep.id, drop.id].sort().join(":");
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({
          id: key,
          reason,
          reasonLabel: label,
          a: keep,
          b: drop,
        });
      }
    }
  }

  for (const [phone, items] of byPhone) {
    if (items.length < 2) continue;
    addPair("phone", items, `Одинаковый телефон ···${phone.slice(-4)}`);
  }
  for (const [, items] of byName) {
    if (items.length < 2) continue;
    // Skip pure name matches already covered by phone unless different phones/null
    addPair("name", items, "Похожее название");
  }

  return pairs.sort((x, y) => {
    if (x.reason !== y.reason) return x.reason === "phone" ? -1 : 1;
    return x.a.name.localeCompare(y.a.name, "ru");
  });
}

export async function getAdminBusinesses(
  supabase: SupabaseClient,
): Promise<AdminBusinessRow[]> {
  const { data, error } = await supabase
    .from("businesses")
    .select(ADMIN_BUSINESS_SELECT)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Omit<AdminBusinessRow, "offers_count">[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const { data: offerRows, error: offerError } = await supabase
    .from("business_offers")
    .select("business_id")
    .in("business_id", ids);

  if (offerError) throw new Error(offerError.message);

  const counts = new Map<string, number>();
  for (const row of offerRows ?? []) {
    const id = row.business_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return rows.map((row) => ({
    ...row,
    offers_count: counts.get(row.id) ?? 0,
  }));
}
