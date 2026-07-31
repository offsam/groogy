import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ReviewWorkspace } from "@/components/admin/ReviewWorkspace";
import { loadReviewWorkspaceTask } from "@/lib/admin/review-workspace/load-task";
import { liveEntityHref } from "@/lib/import-review/live-entity-href";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { userIsAdmin } from "@/lib/reviews/queries";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ taskId: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { taskId } = await params;
  return {
    title: `Review · ${decodeURIComponent(taskId)} — Admin`,
  };
}

export default async function AdminReviewWorkspacePage({ params }: PageProps) {
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

  // Settled queue cards must not stay open in the workspace.
  if (task.payload.kind === "import_review") {
    const item = task.payload.item;
    if (item.review_status === "rejected") {
      redirect("/admin/review/inbox");
    }
    const settled =
      item.review_status === "approved" ||
      item.review_status === "duplicate";
    if (settled) {
      let catalog = supabase;
      try {
        catalog = createServiceRoleClient();
      } catch {
        /* use user client */
      }
      const href =
        (await liveEntityHref(
          catalog,
          item.published_entity_type,
          item.published_entity_id,
        )) ||
        (await liveEntityHref(
          catalog,
          item.duplicate_of_entity_type,
          item.duplicate_of_entity_id,
        ));
      // Merge flow: open the rich live profile when we know it.
      // Otherwise return to inbox so the old card doesn't hang on screen.
      if (href) redirect(href);
      redirect("/admin/review/inbox");
    }
  }

  const { data: categories } =
    task.payload.kind === "import_review"
      ? await supabase
          .from("categories")
          .select("id, slug, name, domain")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
      : { data: [] as Array<{ id: string; slug: string; name: string; domain: string }> };

  return (
    <div className="mx-auto max-w-6xl">
      <ReviewWorkspace
        categories={(categories ?? []).map((c) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          domain: c.domain,
        }))}
        task={task}
      />
    </div>
  );
}
