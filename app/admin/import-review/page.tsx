import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ImportReviewQueuePanel } from "@/components/admin/ImportReviewQueuePanel";
import { LegacyMigrationBanner } from "@/components/admin/LegacyMigrationBanner";
import {
  getImportReviewCounts,
  listImportReviewItems,
} from "@/lib/import-review/queries";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import type {
  ImportReviewEntityType,
  ImportReviewStatus,
  ImportReviewTargetCollection,
} from "@/types/import-review";

export const metadata: Metadata = {
  title: "Импорт → Требуют проверки — Admin",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function AdminImportReviewPage({ searchParams }: PageProps) {
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

  const params = await searchParams;
  const page = Math.max(1, Number(params.page || "1") || 1);
  const pageSize = 25;

  let counts = { total: 0, by_status: {}, by_collection: {} };
  let items: Awaited<ReturnType<typeof listImportReviewItems>>["items"] = [];
  let total = 0;
  let loadError: string | null = null;

  try {
    counts = await getImportReviewCounts(supabase);
    const listed = await listImportReviewItems(supabase, {
      reviewStatus: (params.status as ImportReviewStatus | "all") || "pending",
      targetCollection:
        (params.collection as ImportReviewTargetCollection | "all") || "all",
      entityType: (params.entity_type as ImportReviewEntityType | "all") || "all",
      category: params.category,
      city: params.city,
      hasPhone: params.has_phone === "1",
      hasTelegram: params.has_telegram === "1",
      hasInstagram: params.has_instagram === "1",
      hasWebsite: params.has_website === "1",
      hasMedia: params.has_media === "1",
      duplicateStatus: params.duplicate_status,
      confidenceMin: params.conf_min ? Number(params.conf_min) : undefined,
      confidenceMax: params.conf_max ? Number(params.conf_max) : undefined,
      postedFrom: params.posted_from,
      postedTo: params.posted_to,
      q: params.q,
      sort:
        (params.sort as
          | "priority"
          | "newest"
          | "oldest"
          | "confidence_asc"
          | "confidence_desc"
          | "posted_at"
          | "updated") || "priority",
      page,
      pageSize,
    });
    items = listed.items;
    total = listed.total;
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : null;
    loadError = message?.trim() || "Не удалось загрузить очередь";
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <LegacyMigrationBanner migrationId="import-review" />
      <div>
        <p className="text-sm font-medium text-brand-blue-deep">Импорт</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          Требуют проверки
        </h1>
        <p className="mt-2 max-w-3xl text-slate-500">
          Нажмите карточку — увидите, как она будет на сайте. Одобрить =
          сразу в каталог, отложить = в работу позже, отклонить = в
          отклонённые. Дубликаты уже схлопнуты в основные карточки и из
          очереди убраны.
        </p>
        <p className="mt-3 flex flex-wrap gap-4 text-sm">
          <Link
            href="/admin/recommendations"
            className="font-medium text-brand-blue hover:underline"
          >
            Рекомендации (profi) →
          </Link>
          <Link
            href="/admin/events"
            className="font-medium text-brand-blue hover:underline"
          >
            События — верификация →
          </Link>
        </p>
      </div>

      {params.flash === "rejected" ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Карточка отклонена. Показана следующая из очереди или обновлённый список.
        </div>
      ) : null}
      {params.flash === "approved" ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Карточка одобрена.
        </div>
      ) : null}

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-800">
          {loadError}
        </div>
      ) : (
        <Suspense fallback={<p className="text-sm text-slate-500">Загрузка…</p>}>
          <ImportReviewQueuePanel
            counts={counts}
            items={items}
            page={page}
            pageSize={pageSize}
            total={total}
          />
        </Suspense>
      )}
    </div>
  );
}
