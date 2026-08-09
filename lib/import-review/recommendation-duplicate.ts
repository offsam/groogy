import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";
import { isSharedNonIdentityHost } from "@/lib/import-review/shared-hosts";

export type RecommendationDuplicateStrength = "exact" | "weak";

export type RecommendationDuplicateMatch = {
  entityType: "professional" | "business";
  entityId: string;
  slug: string;
  name: string;
  reason: string;
  /** exact = phone or website; weak = name-only (suspicion only). */
  strength: RecommendationDuplicateStrength;
};

function untyped(client: SupabaseClient) {
  return client as unknown as SupabaseClient;
}

export function websiteHost(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const u = new URL(
      /^https?:\/\//i.test(raw) ? raw : `https://${raw.trim()}`,
    );
    return u.hostname.replace(/^www\./i, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

export function phoneDigits(raw: string | null | undefined): string {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d.length >= 10 ? d.slice(-10) : "";
}

export function isExactDuplicateReason(reason: string | null | undefined): boolean {
  const r = (reason || "").trim();
  return (
    r.startsWith("website:") ||
    r.startsWith("phone:") ||
    r.startsWith("email:") ||
    r.startsWith("instagram:") ||
    r.startsWith("telegram:") ||
    r.startsWith("source_url:") ||
    r.startsWith("address:")
  );
}

function normName(raw: string | null | undefined): string {
  return (raw || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .slice(0, 80);
}

function normCity(raw: string | null | undefined): string {
  return (raw || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

/**
 * True when two city strings are both present and clearly refer to
 * different places (no shared token either way). Common Russian first
 * names/surnames repeat across every diaspora metro — a name-only "weak"
 * match with no other overlapping signal must not pair a card in one
 * city/state with an unrelated card hundreds of miles away just because
 * they share a name. Missing city on either side is not treated as a
 * conflict (we don't have enough info to rule the pair out).
 */
export function citiesConflict(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ka = normCity(a);
  const kb = normCity(b);
  if (!ka || !kb) return false;
  if (ka === kb) return false;
  if (ka.includes(kb) || kb.includes(ka)) return false;
  return true;
}

function hostsFromRecommendation(item: CommentRecommendation): string[] {
  const out: string[] = [];
  for (const w of item.websites || []) {
    const h = websiteHost(w);
    if (h && !isSharedNonIdentityHost(h)) out.push(h);
  }
  return [...new Set(out)];
}

async function findExactByWebsiteOrPhone(
  client: SupabaseClient,
  item: CommentRecommendation,
): Promise<RecommendationDuplicateMatch | null> {
  const hosts = hostsFromRecommendation(item);
  const phones = (item.phones || [])
    .map(phoneDigits)
    .filter((d) => d.length >= 10);
  const db = untyped(client);

  for (const host of hosts) {
    const { data: pros } = await db
      .from("professionals")
      .select("id, slug, display_name, website, status")
      .eq("status", "approved")
      .ilike("website", `%${host}%`)
      .limit(5);
    for (const row of (pros ?? []) as Array<{
      id: string;
      slug: string;
      display_name: string;
      website: string | null;
    }>) {
      if (websiteHost(row.website) === host) {
        return {
          entityType: "professional",
          entityId: row.id,
          slug: row.slug,
          name: row.display_name,
          reason: `website:${host}`,
          strength: "exact",
        };
      }
    }

    const { data: biz } = await db
      .from("businesses")
      .select("id, slug, name, website, status")
      .eq("status", "approved")
      .ilike("website", `%${host}%`)
      .limit(5);
    for (const row of (biz ?? []) as Array<{
      id: string;
      slug: string;
      name: string;
      website: string | null;
    }>) {
      if (websiteHost(row.website) === host) {
        return {
          entityType: "business",
          entityId: row.id,
          slug: row.slug,
          name: row.name,
          reason: `website:${host}`,
          strength: "exact",
        };
      }
    }
  }

  for (const digits of phones) {
    const { data: pros } = await db
      .from("professionals")
      .select("id, slug, display_name, phone, status")
      .eq("status", "approved")
      .not("phone", "is", null)
      .limit(200);
    for (const row of (pros ?? []) as Array<{
      id: string;
      slug: string;
      display_name: string;
      phone: string | null;
    }>) {
      if (phoneDigits(row.phone) === digits) {
        return {
          entityType: "professional",
          entityId: row.id,
          slug: row.slug,
          name: row.display_name,
          reason: `phone:${digits}`,
          strength: "exact",
        };
      }
    }

    const { data: biz } = await db
      .from("businesses")
      .select("id, slug, name, phone, status")
      .eq("status", "approved")
      .not("phone", "is", null)
      .limit(200);
    for (const row of (biz ?? []) as Array<{
      id: string;
      slug: string;
      name: string;
      phone: string | null;
    }>) {
      if (phoneDigits(row.phone) === digits) {
        return {
          entityType: "business",
          entityId: row.id,
          slug: row.slug,
          name: row.name,
          reason: `phone:${digits}`,
          strength: "exact",
        };
      }
    }
  }

  return null;
}

async function findWeakByName(
  client: SupabaseClient,
  item: CommentRecommendation,
): Promise<RecommendationDuplicateMatch | null> {
  const nameKey = normName(item.display_name);
  if (nameKey.length < 8) return null;

  const db = untyped(client);
  const { data: pros } = await db
    .from("professionals")
    .select("id, slug, display_name, city, status")
    .eq("status", "approved")
    .ilike("display_name", `%${(item.display_name || "").trim().slice(0, 40)}%`)
    .limit(8);
  for (const row of (pros ?? []) as Array<{
    id: string;
    slug: string;
    display_name: string;
    city: string | null;
  }>) {
    if (normName(row.display_name) === nameKey && !citiesConflict(item.city, row.city)) {
      return {
        entityType: "professional",
        entityId: row.id,
        slug: row.slug,
        name: row.display_name,
        reason: `name:${row.display_name}`,
        strength: "weak",
      };
    }
  }

  const { data: biz } = await db
    .from("businesses")
    .select("id, slug, name, city, status")
    .eq("status", "approved")
    .ilike("name", `%${(item.display_name || "").trim().slice(0, 40)}%`)
    .limit(8);
  for (const row of (biz ?? []) as Array<{
    id: string;
    slug: string;
    name: string;
    city: string | null;
  }>) {
    if (normName(row.name) === nameKey && !citiesConflict(item.city, row.city)) {
      return {
        entityType: "business",
        entityId: row.id,
        slug: row.slug,
        name: row.name,
        reason: `name:${row.name}`,
        strength: "weak",
      };
    }
  }

  return null;
}

/** Exact only: website host or phone digits. */
export async function findRecommendationExactDuplicate(
  client: SupabaseClient,
  item: CommentRecommendation,
): Promise<RecommendationDuplicateMatch | null> {
  return findExactByWebsiteOrPhone(client, item);
}

/**
 * Find a live professional/business that likely matches this recommendation.
 * Prefer exact (website/phone); optionally include weak name match.
 */
export async function findRecommendationLiveDuplicate(
  client: SupabaseClient,
  item: CommentRecommendation,
  opts: { includeWeak?: boolean } = {},
): Promise<RecommendationDuplicateMatch | null> {
  const exact = await findExactByWebsiteOrPhone(client, item);
  if (exact) return exact;
  if (opts.includeWeak === false) return null;
  return findWeakByName(client, item);
}

/** Parse `address:` / `zip:` / `emails:` from recommendation notes. */
export function parseRecommendationNotes(notes: string | null | undefined): {
  address: string | null;
  zip: string | null;
  email: string | null;
  region: string | null;
} {
  if (!notes?.trim()) {
    return { address: null, zip: null, email: null, region: null };
  }
  const map = new Map<string, string>();
  for (const part of notes.split(";")) {
    const p = part.trim();
    const i = p.indexOf(":");
    if (i <= 0) continue;
    map.set(p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).trim());
  }
  const emails = map.get("emails") || map.get("email") || "";
  return {
    address: map.get("address") || null,
    zip: map.get("zip") || map.get("postal") || map.get("postal_code") || null,
    email: emails.split(",")[0]?.trim().toLowerCase() || null,
    region: map.get("region") || null,
  };
}
