"use client";

import { BusinessCard } from "@/components/business/BusinessCard";
import { ProfessionalCard } from "@/components/professional/ProfessionalCard";
import { ServiceCard } from "@/components/services/ServiceCard";
import { EventCard } from "@/components/events/EventCard";
import { EventProfileView } from "@/components/events/EventProfileView";
import { ImportReviewTypedCard } from "@/components/admin/ImportReviewTypedCard";
import { PreviewSectionBadge } from "@/components/admin/PreviewSectionBadge";
import { recommendationToEventPreview } from "@/lib/events/from-recommendation";
import {
  yellowPagesEntityKind,
  yellowPagesToBusinessPreview,
  yellowPagesToProfessionalPreview,
  yellowPagesToServicePreview,
} from "@/lib/import-review/yellow-pages-preview";
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

/** Renders the public card for the task — no admin-only card design. */
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
    const item = task.payload.item;
    if (item.kind === "event") {
      return (
        <>
          <PreviewSectionBadge kind="events" />
          <EventAffichePreview event={recommendationToEventPreview(item)} />
        </>
      );
    }
    const kind = yellowPagesEntityKind(item);
    if (kind === "professional") {
      return (
        <>
          <PreviewSectionBadge kind="professional" />
          <ProfessionalCard
            professional={yellowPagesToProfessionalPreview(item)}
            preview
          />
        </>
      );
    }
    if (kind === "service") {
      return (
        <>
          <PreviewSectionBadge kind="services" />
          <ServiceCard listing={yellowPagesToServicePreview(item)} preview />
        </>
      );
    }
    return (
      <>
        <PreviewSectionBadge kind="business" />
        <BusinessCard business={yellowPagesToBusinessPreview(item)} preview />
      </>
    );
  }

  return null;
}
