import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CommentRecommendationsPanel } from "@/components/admin/CommentRecommendationsPanel";
import { ScanRecommendationDuplicatesButton } from "@/components/admin/ScanRecommendationDuplicatesButton";
import { PasteRecommendationThreadButton } from "@/components/admin/PasteRecommendationThreadButton";
import {
  countCommentRecommendationsByBucket,
  listCommentRecommendations,
  type RecommendationTargetBucket,
} from "@/lib/import-review/recommendation-queries";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Recommendations — Community — Admin",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

const BUCKETS = new Set([
  "all",
  "professional",
  "business",
  "service",
  "other",
  "unclassified",
]);

/** IA V2 host — moderation also available via Inbox Recommendations View. */
export default async function AdminCommunityRecommendationsPage({
  searchParams,
}: PageProps) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/community/recommendations");
  }
  if (!(await userIsAdmin(supabase))) redirect("/");

  const params = await searchParams;
  const page = Math.max(1, Number(params.page || "1") || 1);
  const pageSize = 400;
  const status = params.status || "pending";
  const rawBucket = params.bucket || "all";
  const bucket = (
    BUCKETS.has(rawBucket) ? rawBucket : "all"
  ) as RecommendationTargetBucket | "all";
  const category = params.category || "all";

  let items: Awaited<ReturnType<typeof listCommentRecommendations>>["items"] =
    [];
  let total = 0;
  let bucketCounts: Record<string, number> = {
    all: 0,
    professional: 0,
    business: 0,
    service: 0,
    other: 0,
    unclassified: 0,
  };
  let loadError: string | null = null;

  try {
    const [listed, counts] = await Promise.all([
      listCommentRecommendations(supabase, {
        status,
        kind: "profi",
        bucket,
        page,
        pageSize,
        excludeBuckets: ["yellow_pages"],
      }),
      countCommentRecommendationsByBucket(supabase, {
        status,
        kind: "profi",
        excludeBuckets: ["yellow_pages"],
      }),
    ]);
    items = listed.items;
    total = listed.total;
    bucketCounts = counts;
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : null;
    loadError = message?.trim() || "Не удалось загрузить рекомендации";
  }

  const { data: categories } = await supabase
    .from("categories")
    .select("id, slug, name, domain")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="text-sm font-medium text-brand-blue-deep">Community</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          Recommendations
        </h1>
        <p className="mt-2 max-w-3xl text-slate-500">
          Специалисты, бизнесы и услуги из комментариев. Основной поток
          модерации — Review Center Inbox.
        </p>
        <p className="mt-3 flex flex-wrap gap-4 text-sm">
          <Link
            href="/admin/review/inbox?view=recommendations"
            className="font-medium text-brand-blue hover:underline"
          >
            Open in Inbox →
          </Link>
          <Link href="/admin/community" className="text-brand-blue hover:underline">
            ← Community
          </Link>
          <Link
            href="/admin/imports/directories"
            className="text-brand-blue hover:underline"
          >
            Imports · Directories
          </Link>
          <ScanRecommendationDuplicatesButton />
          <PasteRecommendationThreadButton />
        </p>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-800">
          {loadError}
        </div>
      ) : (
        <CommentRecommendationsPanel
          bucket={bucket}
          bucketCounts={bucketCounts}
          categories={(categories ?? []).map((c) => ({
            id: c.id,
            slug: c.slug,
            name: c.name,
            domain: c.domain,
          }))}
          category={category}
          items={items}
          listBasePath="/admin/community/recommendations"
          page={page}
          pageSize={pageSize}
          status={status}
          total={total}
        />
      )}
    </div>
  );
}
