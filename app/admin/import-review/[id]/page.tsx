import { redirect } from "next/navigation";
import { reviewWorkspacePath } from "@/lib/admin/review-workspace/task-id";

type PageProps = {
  params: Promise<{ id: string }>;
};

/** Legacy detail → Review Workspace (`import_review:id` or bare UUID). */
export default async function AdminImportReviewDetailRedirect({
  params,
}: PageProps) {
  const { id } = await params;
  redirect(reviewWorkspacePath("import_review", id));
}
