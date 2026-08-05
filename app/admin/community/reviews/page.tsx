import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminReviewsPanel } from "@/components/reviews/AdminReviewsPanel";
import { createServerClient } from "@/lib/supabase/server";
import { getAdminModerationQueue, userIsAdmin } from "@/lib/reviews/queries";
import type { Review, ReviewModerationStatus, ReviewReport } from "@/types/review";

export const metadata: Metadata = {
  title: "Reviews — Community — Admin",
};

export const dynamic = "force-dynamic";

const ALLOWED: Array<ReviewModerationStatus | "reported"> = [
  "manual_review",
  "published",
  "hidden",
  "rejected",
  "expired",
  "verification_pending",
  "verification_in_progress",
  "reported",
];

type PageProps = {
  searchParams: Promise<{ filter?: string }>;
};

/** IA V2 host for review moderation (same panel as legacy `/admin/reviews`). */
export default async function AdminCommunityReviewsPage({
  searchParams,
}: PageProps) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/community/reviews");
  }
  if (!(await userIsAdmin(supabase))) redirect("/");

  const params = await searchParams;
  const raw = params.filter ?? "manual_review";
  const filter = (ALLOWED.includes(raw as ReviewModerationStatus | "reported")
    ? raw
    : "manual_review") as ReviewModerationStatus | "reported";

  let reviews: Review[] = [];
  let openReports: ReviewReport[] = [];
  let sessionsByReviewId: Record<
    string,
    import("@/types/review").ReviewVerificationSession
  > = {};
  let loadError: string | null = null;

  try {
    const queue = await getAdminModerationQueue(supabase, filter);
    reviews = queue.reviews;
    openReports = queue.openReports;
    sessionsByReviewId = queue.sessionsByReviewId;
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "Не удалось загрузить очередь";
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-sm font-medium text-brand-blue-deep">Community</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          Reviews
        </h1>
        <p className="mt-2 text-slate-500">
          Ручная проверка, публикация и жалобы. Score и summary видны только
          здесь.
        </p>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-800">
          {loadError}
          <p className="mt-2 text-red-600">
            Если миграция отзывов ещё не применена — это ожидаемо.
          </p>
        </div>
      ) : (
        <AdminReviewsPanel
          filter={filter}
          openReports={openReports}
          reviews={reviews}
          sessionsByReviewId={sessionsByReviewId}
        />
      )}
    </div>
  );
}
