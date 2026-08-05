import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommunityMention } from "@/types/community-mention";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

function db(client: Client) {
  return client as unknown as SupabaseClient;
}

type MentionRow = {
  id: string;
  business_id: string;
  kind: CommunityMention["kind"];
  source_channel: CommunityMention["sourceChannel"];
  source_label: string | null;
  source_url: string | null;
  source_record_id: string | null;
  snippet: string;
  author_label: string | null;
  status: CommunityMention["status"];
  published_at: string | null;
  created_at: string;
};

export type ProfessionalCommunityMention = {
  id: string;
  professionalId: string;
  kind: string;
  sourceChannel: string;
  sourceLabel: string | null;
  sourceUrl: string | null;
  sourceRecordId: string | null;
  status: string;
  publishedAt: string | null;
  createdAt: string;
};

const SELECT =
  "id, business_id, kind, source_channel, source_label, source_url, source_record_id, snippet, author_label, status, published_at, created_at";

const PRO_SELECT =
  "id, professional_id, kind, source_channel, source_label, source_url, source_record_id, status, published_at, created_at";

export function mapCommunityMention(row: MentionRow): CommunityMention {
  return {
    id: row.id,
    businessId: row.business_id,
    kind: row.kind,
    sourceChannel: row.source_channel,
    sourceLabel: row.source_label,
    sourceUrl: row.source_url,
    sourceRecordId: row.source_record_id,
    snippet: row.snippet,
    authorLabel: row.author_label,
    status: row.status,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  };
}

export async function listPublishedCommunityMentionsForBusiness(
  client: Client,
  businessId: string,
  limit = 20,
): Promise<CommunityMention[]> {
  const { data, error } = await db(client)
    .from("business_community_mentions")
    .select(SELECT)
    .eq("business_id", businessId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as MentionRow[])
    .filter((row) => !String(row.source_record_id || "").startsWith("merged-source:"))
    .filter((row) => row.author_label !== "merge")
    .map(mapCommunityMention);
}

export { thirdPartySourceUrlsFromMentions } from "@/lib/community-mentions/source-urls";

export async function listPublishedCommunityMentionsForProfessional(
  client: Client,
  professionalId: string,
  limit = 40,
): Promise<ProfessionalCommunityMention[]> {
  const { data, error } = await db(client)
    .from("professional_community_mentions")
    .select(PRO_SELECT)
    .eq("professional_id", professionalId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as Array<{
    id: string;
    professional_id: string;
    kind: string;
    source_channel: string;
    source_label: string | null;
    source_url: string | null;
    source_record_id: string | null;
    status: string;
    published_at: string | null;
    created_at: string;
  }>)
    .filter((row) => !String(row.source_record_id || "").startsWith("merged-source:"))
    .map((row) => ({
    id: row.id,
    professionalId: row.professional_id,
    kind: row.kind,
    sourceChannel: row.source_channel,
    sourceLabel: row.source_label,
    sourceUrl: row.source_url,
    sourceRecordId: row.source_record_id,
    status: row.status,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  }));
}
