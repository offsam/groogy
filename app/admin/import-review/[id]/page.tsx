import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ImportReviewDetailPanel } from "@/components/admin/ImportReviewDetailPanel";
import { LegacyMigrationBanner } from "@/components/admin/LegacyMigrationBanner";
import {
  getImportReviewItem,
  listImportReviewItems,
} from "@/lib/import-review/queries";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Проверка импорта — Admin",
};

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function AdminImportReviewDetailPage({
  params,
  searchParams,
}: PageProps) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/import-review");
  }

  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    redirect("/");
  }

  const { id } = await params;
  const sp = await searchParams;
  const filterQuery = new URLSearchParams(
    Object.entries(sp).filter(([, v]) => Boolean(v)) as [string, string][],
  ).toString();

  const item = await getImportReviewItem(supabase, id);
  if (!item) {
    redirect("/admin/import-review");
  }

  const { data: categories } = await supabase
    .from("categories")
    .select("id, slug, name, domain")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  // Next pending card for one-click moderation flow
  let nextPendingId: string | null = null;
  try {
    const { items: pending } = await listImportReviewItems(supabase, {
      reviewStatus: "pending",
      page: 1,
      pageSize: 5,
      sort: "priority",
    });
    nextPendingId = pending.find((p) => p.id !== id)?.id ?? null;
  } catch {
    nextPendingId = null;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <LegacyMigrationBanner migrationId="import-review" />
      <ImportReviewDetailPanel
        categories={(categories ?? []).map((c) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          domain: c.domain,
        }))}
        filterQuery={filterQuery}
        item={item}
        nextPendingId={nextPendingId}
      />
    </div>
  );
}
