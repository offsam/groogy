import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  listCommentRecommendations,
  type CommentRecommendation,
} from "@/lib/import-review/recommendation-queries";
import {
  RECENT_IMPORT_DAYS,
  isRecentlyImported,
} from "@/lib/admin/imports/recent-import";
import {
  TELEGRAM_SOURCES,
  type TelegramSourceId,
} from "@/lib/import-review/telegram-sources";

type Client = SupabaseClient<Database>;

/** Gaps vs TELEGRAM_COLLECTION_CARD_RULES_V1 P0 (admin diagnostic only). */
export type TelegramNewFieldGaps = {
  missingName: boolean;
  missingContact: boolean;
  missingCity: boolean;
  missingImage: boolean;
  weakCategory: boolean;
};

export function telegramNewFieldGaps(
  item: CommentRecommendation,
): TelegramNewFieldGaps {
  const hasName = Boolean(item.display_name?.trim());
  const hasContact =
    (item.phones?.length ?? 0) > 0 ||
    (item.instagram?.length ?? 0) > 0 ||
    (item.websites?.length ?? 0) > 0 ||
    Boolean(item.notes?.toLowerCase().includes("emails:"));
  const hasCity = Boolean(item.city?.trim());
  const hasImage = Boolean(item.cover_image_url?.trim());
  const cat = (item.category_guess || "").trim().toLowerCase();
  const weakCategory =
    !cat ||
    cat === "other" ||
    cat === "услуга / специалист" ||
    cat.includes("other");

  return {
    missingName: !hasName,
    missingContact: !hasContact,
    missingCity: !hasCity,
    missingImage: !hasImage,
    weakCategory,
  };
}

export function recentImportCutoffIso(
  days: number = RECENT_IMPORT_DAYS,
  nowMs: number = Date.now(),
): string {
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function listRecentTelegramImports(
  client: Client,
  opts: {
    days?: number;
    directorySource?: string;
    page?: number;
    pageSize?: number;
    status?: string;
  } = {},
): Promise<{
  items: CommentRecommendation[];
  total: number;
  days: number;
  createdAfter: string;
}> {
  const days = opts.days ?? RECENT_IMPORT_DAYS;
  const createdAfter = recentImportCutoffIso(days);
  // Use updated_at: incremental extract upserts often refresh existing clusters
  // without changing created_at.
  const { items, total } = await listCommentRecommendations(client, {
    sourceChannel: "telegram",
    directorySource: opts.directorySource,
    status: opts.status ?? "pending",
    page: opts.page ?? 1,
    pageSize: opts.pageSize ?? 100,
    updatedAfter: createdAfter,
    orderBy: "updated_at",
  });
  const filtered = items.filter(
    (i) =>
      isRecentlyImported(i.updated_at, days) ||
      isRecentlyImported(i.created_at, days),
  );
  return {
    items: filtered,
    total: Math.max(total, filtered.length),
    days,
    createdAfter,
  };
}

export function telegramSourceTitle(directorySource: string | null): string {
  if (!directorySource) return "Telegram";
  const meta = TELEGRAM_SOURCES[directorySource as TelegramSourceId];
  return meta?.shortTitle ?? directorySource;
}
