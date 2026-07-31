/**
 * Find pending community recommendations that look like the same advertiser
 * as an import-review card (phone / Instagram / website / Telegram / name).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  phoneDigits,
  websiteHost,
} from "@/lib/import-review/recommendation-duplicate";
import { isSharedNonIdentityHost } from "@/lib/import-review/shared-hosts";

export type MatchingRecommendation = {
  id: string;
  title: string | null;
  reason: string;
  mentionCount: number;
  thirdParty: number;
  selfAd: number;
  /** Short text so the scan UI can show what this recommendation says. */
  snippet: string | null;
};

type ImportSignals = {
  phones: string[];
  instagram: string[];
  website: string[];
  telegram_username?: string | null;
  business_name?: string | null;
  title?: string | null;
  person_name?: string | null;
};

function instagramHandle(raw: string | null | undefined): string | null {
  const t = (raw || "").trim();
  if (!t) return null;
  try {
    if (/instagram\.com/i.test(t)) {
      const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
      const handle = u.pathname.split("/").filter(Boolean)[0] || "";
      return handle.replace(/^@/, "").toLowerCase() || null;
    }
  } catch {
    /* plain handle */
  }
  const handle = t.replace(/^@/, "").replace(/\/+$/, "").toLowerCase();
  if (!/^[a-z0-9._]{2,30}$/.test(handle)) return null;
  if (["p", "reel", "reels", "stories", "explore"].includes(handle)) return null;
  return handle;
}

function telegramKey(raw: string | null | undefined): string | null {
  const t = (raw || "").trim();
  if (!t) return null;
  try {
    if (/t\.me|telegram\./i.test(t)) {
      const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
      const part = u.pathname.split("/").filter(Boolean)[0] || "";
      return part.replace(/^@/, "").toLowerCase() || null;
    }
  } catch {
    /* plain */
  }
  const handle = t.replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_]{3,32}$/.test(handle) ? handle : null;
}

function normName(raw: string | null | undefined): string {
  return (raw || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .slice(0, 80);
}

function ownWebsiteHost(raw: string | null | undefined): string | null {
  const h = websiteHost(raw);
  if (!h || isSharedNonIdentityHost(h)) return null;
  return h;
}

const REC_SELECT =
  "id, display_name, phones, websites, instagram, status, kind, mention_count, third_party_mention_count, self_ad_mention_count, comment_texts, request_snippets";

/**
 * Pending / suspected recommendations sharing a contact or the same name as
 * the import card. Exact contact wins; name-only is kept as a weak hit.
 */
export async function findMatchingRecommendations(
  client: SupabaseClient,
  item: ImportSignals,
): Promise<MatchingRecommendation[]> {
  const selfPhones = new Set(
    (item.phones || [])
      .map(phoneDigits)
      .filter((d) => d.length >= 10),
  );
  const selfIg = new Set(
    (item.instagram || [])
      .map(instagramHandle)
      .filter((h): h is string => Boolean(h)),
  );
  const selfHosts = new Set(
    (item.website || [])
      .map(ownWebsiteHost)
      .filter((h): h is string => Boolean(h)),
  );
  const selfTg = telegramKey(item.telegram_username);
  const selfNames = new Set(
    [item.business_name, item.person_name, item.title]
      .map(normName)
      .filter((n) => n.length >= 4),
  );

  if (
    !selfPhones.size &&
    !selfIg.size &&
    !selfHosts.size &&
    !selfTg &&
    !selfNames.size
  ) {
    return [];
  }

  const db = client as unknown as SupabaseClient;
  const { data, error } = await db
    .from("import_comment_recommendations")
    .select(REC_SELECT)
    .in("status", ["pending", "suspected_duplicate"])
    .neq("kind", "event")
    .order("mention_count", { ascending: false })
    .limit(500);
  if (error || !data?.length) return [];

  const hits: MatchingRecommendation[] = [];
  for (const raw of data as Array<Record<string, unknown>>) {
    let reason: string | null = null;

    for (const p of (raw.phones as string[]) || []) {
      const d = phoneDigits(p);
      if (d && selfPhones.has(d)) {
        reason = `phone:${d}`;
        break;
      }
    }
    if (!reason) {
      for (const ig of (raw.instagram as string[]) || []) {
        const h = instagramHandle(ig);
        if (h && selfIg.has(h)) {
          reason = `instagram:@${h}`;
          break;
        }
      }
    }
    if (!reason) {
      for (const w of (raw.websites as string[]) || []) {
        const h = ownWebsiteHost(w);
        if (h && selfHosts.has(h)) {
          reason = `website:${h}`;
          break;
        }
      }
    }
    if (!reason && selfTg) {
      const name = String(raw.display_name || "").toLowerCase();
      if (name === selfTg || name === `@${selfTg}`) {
        reason = `telegram:@${selfTg}`;
      }
    }
    if (!reason && selfNames.size) {
      const n = normName(String(raw.display_name || ""));
      if (n && selfNames.has(n)) reason = `name:${raw.display_name}`;
    }
    if (!reason) continue;

    hits.push({
      id: String(raw.id),
      title: (raw.display_name as string) || null,
      reason: `рекомендация · ${reason}`,
      mentionCount: Number(raw.mention_count ?? 1),
      thirdParty: Number(raw.third_party_mention_count ?? 0),
      selfAd: Number(raw.self_ad_mention_count ?? 0),
      snippet:
        (
          ((raw.request_snippets as string[]) || [])[0] ||
          ((raw.comment_texts as string[]) || [])[0] ||
          ""
        )
          .trim()
          .slice(0, 220) || null,
    });
    if (hits.length >= 30) break;
  }

  return hits;
}
