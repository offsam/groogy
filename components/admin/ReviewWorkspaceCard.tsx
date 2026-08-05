"use client";

import { BusinessCard } from "@/components/business/BusinessCard";
import { EventCard } from "@/components/events/EventCard";
import { EventProfileView } from "@/components/events/EventProfileView";
import { ImportReviewTypedCard } from "@/components/admin/ImportReviewTypedCard";
import { recommendationToImportPreviewFields } from "@/lib/import-review/yellow-pages-preview";
import type { ReviewWorkspaceTask } from "@/lib/admin/review-workspace/types";
import type { PlatformEvent } from "@/lib/events/queries";

type Props = {
  task: ReviewWorkspaceTask;
};

function EventAffichePreview({ event }: { event: PlatformEvent }) {
  return (
    <div className="space-y-4">
      <EventProfileView event={event} preview />
      <div className="max-w-sm">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          Карточка в ленте
        </p>
        <EventCard event={event} preview />
      </div>
    </div>
  );
}

/** Renders the public card for the task — same chrome as the publish queue. */
export function ReviewWorkspaceCard({ task }: Props) {
  if (task.payload.kind === "import_review") {
    return (
      <ImportReviewTypedCard
        item={task.payload.item}
        showSectionBadge
        className="max-w-xl"
      />
    );
  }

  if (task.payload.kind === "ownership_claim") {
    const { business, claim } = task.payload;
    if (business) {
      return <BusinessCard business={business} preview />;
    }
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-900">
          {claim.businessName || "Бизнес"}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Карточка бизнеса недоступна для превью — откройте публичную страницу.
        </p>
      </div>
    );
  }

  if (task.payload.kind === "event_verification") {
    return <EventAffichePreview event={task.payload.eventPreview} />;
  }

  if (task.payload.kind === "recommendation") {
    return (
      <ImportReviewTypedCard
        item={recommendationToImportPreviewFields(task.payload.item)}
        showSectionBadge
        className="max-w-xl"
      />
    );
  }

  return null;
}
