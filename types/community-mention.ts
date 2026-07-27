/** Community recommendations / comment mentions (not formal star reviews). */

export type CommunityMentionKind =
  | "comment_recommendation"
  | "third_party_recommendation"
  | "community_mention";

export type CommunityMentionSourceChannel =
  | "facebook"
  | "telegram"
  | "import"
  | "admin"
  | "other";

export type CommunityMentionStatus =
  | "draft"
  | "published"
  | "hidden"
  | "archived";

export type CommunityMention = {
  id: string;
  businessId: string;
  kind: CommunityMentionKind;
  sourceChannel: CommunityMentionSourceChannel;
  sourceLabel: string | null;
  sourceUrl: string | null;
  sourceRecordId: string | null;
  snippet: string;
  authorLabel: string | null;
  status: CommunityMentionStatus;
  publishedAt: string | null;
  createdAt: string;
};

export const COMMUNITY_MENTION_KIND_LABELS: Record<CommunityMentionKind, string> = {
  comment_recommendation: "Рекомендация в комментариях",
  third_party_recommendation: "Рекомендация сообщества",
  community_mention: "Упоминание",
};

export const COMMUNITY_MENTION_CHANNEL_LABELS: Record<
  CommunityMentionSourceChannel,
  string
> = {
  facebook: "Facebook",
  telegram: "Telegram",
  import: "Импорт",
  admin: "Админ",
  other: "Другое",
};
