"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import { ImportReviewTypedCard } from "@/components/admin/ImportReviewTypedCard";
import { ReviewCardMetrics } from "@/components/admin/ReviewCardMetrics";
import { ReviewFullPagePreviewModal } from "@/components/admin/ReviewFullPagePreviewModal";
import { ReviewPreviewEnrichPanel } from "@/components/admin/ReviewPreviewEnrichPanel";
import { ReviewImportDuplicatesPanel } from "@/components/admin/ReviewImportDuplicatesPanel";
import { AdminPasteEnrichButton } from "@/components/admin/AdminPasteEnrichButton";
import { Button } from "@/components/ui/Button";
import type { ReviewCategoryOption } from "@/lib/import-review/category-options";
import {
  hubPreviewLabel,
  importTypesToHub,
} from "@/lib/import-review/hub-preview";
import {
  IMPORT_PREVIEW_KIND_HINTS,
  resolveImportPreviewKind,
} from "@/lib/import-review/preview-section";
import type { ImportReviewItem } from "@/types/import-review";

type Props = {
  item: ImportReviewItem;
  categories?: ReviewCategoryOption[];
  inboxPriority?: number | null;
};

/**
 * Workspace teaser + entry to full-page public preview with hub type switcher.
 * Mobile (max-sm) is compacted; sm+ layout unchanged.
 */
export function ReviewHubPreviewPanel({
  item,
  categories = [],
  inboxPriority = null,
}: Props) {
  const [open, setOpen] = useState(false);
  const hub = importTypesToHub(item.target_collection, item.entity_type);
  const kind = resolveImportPreviewKind(item);
  const locked =
    item.review_status === "approved" ||
    item.review_status === "rejected" ||
    item.review_status === "duplicate";

  return (
    <>
      <div className="min-w-0 overflow-x-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-3 sm:rounded-2xl sm:p-5">
        <div className="mb-2 flex flex-col gap-2 sm:mb-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-3">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Card preview
              </p>
              <p className="mt-0.5 truncate text-xs text-slate-600 sm:mt-1 sm:text-sm">
                {hubPreviewLabel(hub)} · {IMPORT_PREVIEW_KIND_HINTS[kind]}
              </p>
            </div>
            <ReviewCardMetrics
              className="sm:hidden"
              compact
              inboxPriority={inboxPriority}
              item={item}
            />
          </div>
          <div className="relative z-10 flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            <ReviewPreviewEnrichPanel itemId={item.id} disabled={locked} />
            <AdminPasteEnrichButton
              kind="import_review"
              entityId={item.id}
              variant="button"
              disabled={locked}
            />
            {/* Scan stays available after approve: an already-published
                card can still be a duplicate of another live one. */}
            <ReviewImportDuplicatesPanel
              itemId={item.id}
              cardSignals={{
                phones: item.phone,
                telegramUsername: item.telegram_username,
                telegramUserId: item.telegram_user_id,
                instagram: item.instagram,
                website: item.website,
                names: [
                  item.title,
                  item.business_name,
                  item.person_name,
                ].filter((x): x is string => Boolean(x?.trim())),
              }}
            />
            <Button
              type="button"
              className="relative z-10 w-full shrink-0 sm:w-auto"
              onClick={() => setOpen(true)}
              disabled={locked && !item.entity_type}
            >
              <Eye className="mr-2 size-4" />
              <span className="sm:hidden">Просмотр</span>
              <span className="hidden sm:inline">Предварительный просмотр</span>
            </Button>
          </div>
        </div>

        <ImportReviewTypedCard
          item={item}
          showSectionBadge
          className="min-w-0 w-full max-w-full overflow-hidden sm:max-w-xl"
        />

        <ReviewCardMetrics
          className="mt-3 hidden sm:block"
          inboxPriority={inboxPriority}
          item={item}
        />

        <p className="mt-3 hidden text-xs leading-relaxed text-slate-500 sm:block">
          Откройте полный просмотр — страница как у пользователя. Там можно
          переключить раздел и категорию (бухгалтерия, авто и т.д.).
        </p>
      </div>

      <ReviewFullPagePreviewModal
        categories={categories}
        item={item}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
