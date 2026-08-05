"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";
import { ReviewFullPagePreviewModal } from "@/components/admin/ReviewFullPagePreviewModal";
import { ReviewWorkspaceCard } from "@/components/admin/ReviewWorkspaceCard";
import { AdminPublishedEnrichButton } from "@/components/admin/AdminPublishedEnrichButton";
import { AdminPublishedDuplicatesButton } from "@/components/admin/AdminPublishedDuplicatesButton";
import { AdminPasteEnrichButton } from "@/components/admin/AdminPasteEnrichButton";
import { Button } from "@/components/ui/Button";
import type { ReviewWorkspaceTask } from "@/lib/admin/review-workspace/types";
import type { ReviewCategoryOption } from "@/lib/import-review/category-options";
import {
  hubPreviewLabel,
  importTypesToHub,
} from "@/lib/import-review/hub-preview";
import {
  IMPORT_PREVIEW_KIND_HINTS,
  resolveImportPreviewKind,
} from "@/lib/import-review/preview-section";
import { approveCommentRecommendationAction } from "@/lib/import-review/recommendation-actions";
import { recommendationToSyntheticImportItem } from "@/lib/import-review/yellow-pages-preview";
import { yellowPagesEntityKind } from "@/lib/import-review/yellow-pages-preview";

type Props = {
  task: ReviewWorkspaceTask;
  categories?: ReviewCategoryOption[];
};

/**
 * Recommendation workspace teaser + full public-profile Preview.
 * Same shell as ReviewHubPreviewPanel (Card preview + dashed block).
 */
export function ReviewRecommendationPreviewPanel({
  task,
  categories = [],
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const item =
    task.payload.kind === "recommendation" ? task.payload.item : null;
  const synthetic = useMemo(
    () => (item ? recommendationToSyntheticImportItem(item) : null),
    [item],
  );

  if (!item || !synthetic) return null;

  const locked = item.status === "approved" || item.status === "rejected";
  const hub = importTypesToHub(
    synthetic.target_collection,
    synthetic.entity_type,
  );
  const kind = resolveImportPreviewKind(synthetic);
  const enrichKind =
    item.kind === "event"
      ? ("event" as const)
      : yellowPagesEntityKind(item) === "professional"
        ? ("professional" as const)
        : yellowPagesEntityKind(item) === "service"
          ? ("service" as const)
          : ("business" as const);

  return (
    <>
      <div className="min-w-0 overflow-x-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-3 sm:rounded-2xl sm:p-5">
        <div className="mb-2 flex flex-col gap-2 sm:mb-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Card preview
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-600 sm:mt-1 sm:text-sm">
              {hubPreviewLabel(hub)} · {IMPORT_PREVIEW_KIND_HINTS[kind]}
            </p>
          </div>
          <div className="relative z-10 flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            <AdminPublishedEnrichButton
              disabled={locked}
              entityId={item.id}
              kind={enrichKind}
              onEnriched={() => router.refresh()}
              queue={{ source: "recommendation", id: item.id }}
            />
            <AdminPublishedDuplicatesButton
              disabled={locked}
              entityId={item.id}
              kind={enrichKind}
              queue={{ source: "recommendation", id: item.id }}
            />
            <AdminPasteEnrichButton
              kind="recommendation"
              entityId={item.id}
              variant="button"
              disabled={locked}
            />
            <Button
              type="button"
              className="relative z-10 w-full shrink-0 sm:w-auto"
              onClick={() => setOpen(true)}
            >
              <Eye className="mr-2 size-4" />
              <span className="sm:hidden">Просмотр</span>
              <span className="hidden sm:inline">Предварительный просмотр</span>
            </Button>
          </div>
        </div>

        <ReviewWorkspaceCard task={task} />

        <p className="mt-3 hidden text-xs leading-relaxed text-slate-500 sm:block">
          Откройте полный просмотр — страница как у пользователя. Там же панель
          админа (обогатить, двойники, категория) и кнопка «Опубликовать».
        </p>
      </div>

      <ReviewFullPagePreviewModal
        categories={categories}
        item={synthetic}
        open={open}
        publishDisabled={locked}
        publishLabel="Опубликовать"
        queueSource="recommendation"
        readOnlyHub
        onClose={() => setOpen(false)}
        onPublish={async () => {
          if (locked) {
            return { ok: false, message: "Запись уже закрыта." };
          }
          const res = await approveCommentRecommendationAction({
            id: item.id,
          });
          if (res.ok) {
            setOpen(false);
            router.refresh();
          }
          return res;
        }}
      />
    </>
  );
}
