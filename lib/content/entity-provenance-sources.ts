/**
 * Collect all provenance URLs for a live business / professional:
 * primary source_url + secondary trails saved at merge (merged-source:*)
 * + unique recommendation source_post_urls.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isDirectorySourceUrl,
  isFacebookUrl,
  isTelegramUrl,
  type SourceKind,
} from "@/lib/business/presence";

export type ProvenanceSourceHit = {
  url: string;
  kind: SourceKind;
  label: string;
};

function normalizeUrlKey(url: string): string {
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, "").toLowerCase();
  } catch {
    return url.trim().replace(/\/+$/, "").toLowerCase();
  }
}

export function inferProvenanceKind(url: string): SourceKind {
  if (isFacebookUrl(url)) return "facebook";
  if (isTelegramUrl(url)) return "telegram";
  if (isDirectorySourceUrl(url)) return "directory";
  return "directory";
}

function hostLabel(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(
      /^www\./,
      "",
    );
  } catch {
    return "источник";
  }
}

function untyped(client: SupabaseClient) {
  return client as unknown as SupabaseClient;
}

/**
 * Primary profile URL first, then merge-preserved mentions, then unique rec URLs.
 */
export async function listEntityProvenanceSources(
  catalog: SupabaseClient,
  input: {
    entityType: "business" | "professional";
    entityId: string;
    primaryUrl?: string | null;
    primaryKind?: SourceKind;
  },
): Promise<ProvenanceSourceHit[]> {
  const db = untyped(catalog);
  const out: ProvenanceSourceHit[] = [];
  const seen = new Set<string>();

  const push = (url: string | null | undefined, label: string, kind?: SourceKind) => {
    const trimmed = (url || "").trim();
    if (!trimmed) return;
    const key = normalizeUrlKey(trimmed);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      url: trimmed,
      kind: kind ?? inferProvenanceKind(trimmed),
      label: label.slice(0, 120),
    });
  };

  if (input.primaryUrl?.trim()) {
    push(
      input.primaryUrl,
      hostLabel(input.primaryUrl),
      input.primaryKind ?? inferProvenanceKind(input.primaryUrl),
    );
  }

  const mentionTable =
    input.entityType === "professional"
      ? "professional_community_mentions"
      : "business_community_mentions";
  const mentionFk =
    input.entityType === "professional" ? "professional_id" : "business_id";

  const { data: mentions } = await db
    .from(mentionTable)
    .select("source_url, source_label, source_record_id, kind, status")
    .eq(mentionFk, input.entityId)
    .not("source_url", "is", null)
    .limit(50);

  for (const row of (mentions ?? []) as Array<Record<string, unknown>>) {
    const rid = String(row.source_record_id || "");
    // Merge-preserved secondary sources (often status=hidden so they stay
    // out of «Рекомендации сообщества»).
    if (!rid.startsWith("merged-source:")) continue;
    const url = String(row.source_url || "");
    push(
      url,
      String(row.source_label || hostLabel(url) || "источник при слиянии"),
    );
  }

  const { data: recs } = await db
    .from("import_comment_recommendations")
    .select("display_name, source_post_urls, published_entity_id")
    .eq("published_entity_id", input.entityId)
    .eq("published_entity_type", input.entityType)
    .limit(40);

  for (const row of (recs ?? []) as Array<Record<string, unknown>>) {
    const urls = (row.source_post_urls as string[]) || [];
    const name = String(row.display_name || "").trim();
    for (const raw of urls) {
      push(raw, name || hostLabel(raw));
    }
  }

  return out;
}
