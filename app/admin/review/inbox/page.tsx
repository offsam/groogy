import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ReviewInboxPanel } from "@/components/admin/ReviewInboxPanel";
import { ScanRecommendationDuplicatesButton } from "@/components/admin/ScanRecommendationDuplicatesButton";
import { loadInboxItems } from "@/lib/admin/inbox/queries";
import { getInboxView } from "@/lib/admin/inbox/views";
import type {
  InboxEntityType,
  InboxFilters,
  InboxReviewType,
  InboxSourceKey,
  InboxViewId,
} from "@/lib/admin/inbox/types";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Review Center — Inbox — Admin",
};

export const dynamic = "force-dynamic";
/** Working-set fetch (capped per source) — keep under a short serverless budget. */
export const maxDuration = 30;

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

function parseFilters(
  params: Record<string, string | undefined>,
): InboxFilters {
  const viewRaw = params.view || "all";
  const view = getInboxView(viewRaw).id as InboxViewId;

  return {
    view,
    entityType: params.entity as InboxEntityType | "all" | undefined,
    source: params.source as InboxSourceKey | "all" | undefined,
    status: params.status,
    reviewType: params.reviewType as InboxReviewType | "all" | undefined,
    sourceRef: params.sourceRef,
    q: params.q,
    minConfidence: params.minConfidence
      ? Number(params.minConfidence)
      : undefined,
    maxAgeHours: params.maxAgeHours ? Number(params.maxAgeHours) : undefined,
    needsReview:
      params.needsReview === "1" || params.needsReview === "true"
        ? true
        : params.needsReview === "0"
          ? false
          : undefined,
  };
}

export default async function AdminReviewInboxPage({ searchParams }: PageProps) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/review/inbox");
  }

  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    redirect("/");
  }

  const params = await searchParams;
  const rawFilters = parseFilters(params);
  const result = await loadInboxItems(supabase, rawFilters);
  const activeView = result.filters.view ?? "all";
  const userLabel =
    user.email?.split("@")[0] ||
    user.user_metadata?.full_name ||
    user.id.slice(0, 8);

  return (
    <div className="mx-auto max-w-6xl space-y-3 sm:space-y-5">
      <div>
        <p className="text-xs font-medium text-brand-blue-deep sm:text-sm">
          Review Center
        </p>
        <h1 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900 sm:mt-1 sm:text-3xl">
          Inbox
        </h1>
        <p className="mt-1 hidden max-w-3xl text-slate-500 sm:mt-2 sm:block">
          Единая точка входа модератора: Saved Views, bulk-действия и Workspace
          для каждой задачи.
        </p>
        <div className="mt-3">
          <ScanRecommendationDuplicatesButton />
        </div>
      </div>

      <Suspense
        fallback={
          <p className="text-sm text-slate-500">Загрузка Inbox…</p>
        }
      >
        <ReviewInboxPanel
          items={result.items}
          allItems={result.allItems}
          totalUnfiltered={result.totalUnfiltered}
          totalFiltered={result.totalFiltered}
          loadedUnfiltered={result.loadedUnfiltered}
          byReviewType={result.byReviewType}
          errors={result.errors}
          activeView={activeView}
          resolvedFilters={result.filters}
          metrics={result.metrics}
          currentUser={{ id: user.id, label: String(userLabel) }}
        />
      </Suspense>
    </div>
  );
}
