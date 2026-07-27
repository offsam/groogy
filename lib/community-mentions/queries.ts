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

const SELECT =
  "id, business_id, kind, source_channel, source_label, source_url, source_record_id, snippet, author_label, status, published_at, created_at";

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
  return ((data ?? []) as MentionRow[]).map(mapCommunityMention);
}
