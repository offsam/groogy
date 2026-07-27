import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CommentRecommendationsPanel } from "@/components/admin/CommentRecommendationsPanel";
import {
  countCommentRecommendationsByBucket,
  listCommentRecommendations,
  type RecommendationTargetBucket,
} from "@/lib/import-review/recommendation-queries";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Рекомендации из комментариев — Admin",
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

export default async function AdminRecommendationsPage({
  searchParams,
}: PageProps) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/recommendations");
  }

  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    redirect("/");
  }

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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="text-sm font-medium text-brand-blue-deep">Импорт</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          Рекомендации — перед переносом
        </h1>
        <p className="mt-2 max-w-3xl text-slate-500">
          Специалисты, бизнесы и услуги из Facebook и Telegram. Переносим только
          карточки с якорем (пост или контакт). Без якоря остаются отдельно.
        </p>
        <p className="mt-3 flex flex-wrap gap-4 text-sm">
          <Link
            href="/admin/import-review"
            className="text-brand-blue hover:underline"
          >
            ← Очередь импорта
          </Link>
          <Link
            href="/admin/directories"
            className="text-brand-blue hover:underline"
          >
            Справочники →
          </Link>
          <Link
            href="/admin/events"
            className="text-brand-blue hover:underline"
          >
            События — верификация →
          </Link>
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
          category={category}
          items={items}
          page={page}
          pageSize={pageSize}
          status={status}
          total={total}
        />
      )}
    </div>
  );
}
