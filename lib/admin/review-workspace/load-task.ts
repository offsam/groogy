import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getPendingBusinessClaims } from "@/lib/admin/claim-actions";
import {
  fromCommentRecommendation,
  fromEventRecommendation,
  fromImportReviewItem,
  fromOwnershipClaim,
} from "@/lib/admin/inbox/adapters";
import { getImportReviewItem } from "@/lib/import-review/queries";
import type { ImportReviewListItem } from "@/lib/import-review/queries";
import {
  contactLevelFromFlags,
  computeContactPriorityScore,
  getContactFlags,
} from "@/lib/import-review/contacts";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";
import type { ImportReviewItem } from "@/types/import-review";
import { recommendationToEventPreview } from "@/lib/events/from-recommendation";
import { getBusinessBySlugForOwner } from "@/lib/supabase/queries";
import {
  parseReviewTaskId,
  reviewWorkspacePath,
} from "@/lib/admin/review-workspace/task-id";
import type { ReviewWorkspaceTask } from "@/lib/admin/review-workspace/types";

export { recommendationToEventPreview };

export type {
  ReviewWorkspacePayload,
  ReviewWorkspaceTask,
} from "@/lib/admin/review-workspace/types";

type Client = SupabaseClient<Database>;

function asImportListItem(item: ImportReviewItem): ImportReviewListItem {
  const flags = getContactFlags(item);
  return {
    ...item,
    contact_priority_score: computeContactPriorityScore(flags),
    completeness_score: 0,
    contact_level: contactLevelFromFlags(flags),
  };
}

function recommendationsTable(client: Client) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table pending in Database types
  return (client as SupabaseClient<any>).from("import_comment_recommendations");
}

export async function getCommentRecommendationById(
  client: Client,
  id: string,
): Promise<CommentRecommendation | null> {
  const { data, error } = await recommendationsTable(client)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as CommentRecommendation;
  return {
    ...row,
    target_bucket: row.target_bucket || "unclassified",
    directory_source: row.directory_source ?? null,
    third_party_mention_count: Number(row.third_party_mention_count ?? 0),
    self_ad_mention_count: Number(row.self_ad_mention_count ?? 0),
    mention_count: Number(row.mention_count ?? 1),
  };
}

export async function loadReviewWorkspaceTask(
  client: Client,
  taskIdParam: string,
): Promise<ReviewWorkspaceTask | null> {
  const parsed = parseReviewTaskId(taskIdParam);
  if (!parsed) return null;

  const { reviewType, sourceId } = parsed;
  const taskId = `${reviewType}:${sourceId}`;

  if (reviewType === "import_review") {
    const item = await getImportReviewItem(client, sourceId);
    if (!item) return null;
    const listItem = asImportListItem(item);
    const meta = fromImportReviewItem(listItem);
    meta.targetUrl = reviewWorkspacePath(reviewType, sourceId);
    return {
      taskId,
      reviewType,
      sourceId,
      meta,
      originalUrl: `/admin/import-review/${sourceId}`,
      publicUrl: null,
      sourceUrl: item.source_url,
      payload: { kind: "import_review", item },
    };
  }

  if (reviewType === "ownership_claim") {
    const claims = await getPendingBusinessClaims();
    const claim = claims.find((c) => c.id === sourceId) ?? null;
    if (!claim) return null;
    const business = claim.businessSlug
      ? await getBusinessBySlugForOwner(client, claim.businessSlug).catch(
          () => null,
        )
      : null;
    const meta = fromOwnershipClaim(claim);
    meta.targetUrl = reviewWorkspacePath(reviewType, sourceId);
    return {
      taskId,
      reviewType,
      sourceId,
      meta,
      originalUrl: "/admin/claims",
      publicUrl: claim.businessSlug
        ? `/business/${claim.businessSlug}`
        : null,
      sourceUrl: null,
      payload: { kind: "ownership_claim", claim, business },
    };
  }

  if (reviewType === "event_verification") {
    const item = await getCommentRecommendationById(client, sourceId);
    if (!item || item.kind !== "event") return null;
    const meta = fromEventRecommendation(item);
    meta.targetUrl = reviewWorkspacePath(reviewType, sourceId);
    return {
      taskId,
      reviewType,
      sourceId,
      meta,
      originalUrl: "/admin/events",
      publicUrl: null,
      sourceUrl: item.source_post_urls?.[0] ?? null,
      payload: {
        kind: "event_verification",
        item,
        eventPreview: recommendationToEventPreview(item),
      },
    };
  }

  if (reviewType === "recommendation") {
    const item = await getCommentRecommendationById(client, sourceId);
    if (!item || item.kind === "event") return null;

    // Exact phone/website → auto-attach; weak name → suspect.
    if (
      item.status === "pending" ||
      item.status === "suspected_duplicate"
    ) {
      try {
        const { autoAttachOrSuspectRecommendationAction } = await import(
          "@/lib/import-review/recommendation-actions"
        );
        await autoAttachOrSuspectRecommendationAction({ id: sourceId });
      } catch {
        // Non-fatal — workspace still loads.
      }
    }

    const refreshed =
      (await getCommentRecommendationById(client, sourceId).catch(() => null)) ||
      item;
    const meta = fromCommentRecommendation(refreshed);
    meta.targetUrl = reviewWorkspacePath(reviewType, sourceId);

    let publicUrl: string | null = null;
    if (
      refreshed.status === "merged" &&
      refreshed.published_entity_id &&
      refreshed.published_entity_type
    ) {
      const table =
        refreshed.published_entity_type === "professional"
          ? "professionals"
          : "businesses";
      const { data: live } = await (
        client as unknown as SupabaseClient
      )
        .from(table)
        .select("slug")
        .eq("id", refreshed.published_entity_id)
        .maybeSingle();
      const slug = (live as { slug?: string } | null)?.slug;
      if (slug) {
        publicUrl =
          refreshed.published_entity_type === "professional"
            ? `/professional/${slug}`
            : `/business/${slug}`;
      }
    }

    return {
      taskId,
      reviewType,
      sourceId,
      meta,
      originalUrl: "/admin/recommendations",
      publicUrl,
      sourceUrl: refreshed.source_post_urls?.[0] ?? null,
      payload: { kind: "recommendation", item: refreshed },
    };
  }

  return null;
}
