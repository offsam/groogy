import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminBusinessForm } from "@/components/admin/AdminBusinessForm";
import { ImportReviewDetailPanel } from "@/components/admin/ImportReviewDetailPanel";
import { ReviewWorkspaceEditPanel } from "@/components/admin/ReviewWorkspaceEditPanel";
import { loadReviewWorkspaceTask } from "@/lib/admin/review-workspace/load-task";
import { reviewWorkspacePath } from "@/lib/admin/review-workspace/task-id";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import { getActiveCategories } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ taskId: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { taskId } = await params;
  return {
    title: `Edit · ${decodeURIComponent(taskId)} — Admin`,
  };
}

export default async function AdminReviewWorkspaceEditPage({
  params,
}: PageProps) {
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

  const { taskId } = await params;
  const task = await loadReviewWorkspaceTask(supabase, taskId);
  if (!task) {
    redirect("/admin/review/inbox");
  }

  const workspaceHref = reviewWorkspacePath(task.reviewType, task.sourceId);

  if (task.payload.kind === "import_review") {
    const { data: categories } = await supabase
      .from("categories")
      .select("id, slug, name, domain")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <ImportReviewDetailPanel
          item={task.payload.item}
          categories={(categories ?? []).map((c) => ({
            id: c.id,
            slug: c.slug,
            name: c.name,
            domain: c.domain,
          }))}
          filterQuery=""
          returnHref={workspaceHref}
          listHref={workspaceHref}
        />
      </div>
    );
  }

  if (task.payload.kind === "ownership_claim") {
    const businessId =
      task.payload.business?.id ?? task.payload.claim.businessId;
    const categories = await getActiveCategories(supabase);
    const { data: row } = await supabase
      .from("businesses")
      .select(
        "id, name, slug, short_description, description, phone, website, instagram_url, google_maps_url, google_rating, google_reviews_count, city, address_line, region, state_code, postal_code, status, category_id",
      )
      .eq("id", businessId)
      .maybeSingle();

    if (!row) {
      return (
        <div className="mx-auto max-w-2xl">
          <ReviewWorkspaceEditPanel task={task} />
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <ReviewWorkspaceEditPanel task={task} />
        <AdminBusinessForm
          categories={categories.map((c) => ({
            id: c.id,
            slug: c.slug,
            name: c.name,
          }))}
          initial={{
            id: row.id,
            name: row.name,
            slug: row.slug,
            short_description: row.short_description,
            description: row.description,
            phone: row.phone,
            website: row.website,
            instagram_url: row.instagram_url,
            google_maps_url: row.google_maps_url,
            google_rating: row.google_rating,
            google_reviews_count: row.google_reviews_count,
            city: row.city,
            address_line: row.address_line,
            region: row.region,
            state_code: row.state_code,
            postal_code: row.postal_code,
            status: row.status,
            category_id: row.category_id,
          }}
        />
      </div>
    );
  }

  if (
    task.payload.kind === "recommendation" ||
    task.payload.kind === "event_verification"
  ) {
    return (
      <div className="mx-auto max-w-2xl">
        <ReviewWorkspaceEditPanel task={task} />
      </div>
    );
  }

  notFound();
}
