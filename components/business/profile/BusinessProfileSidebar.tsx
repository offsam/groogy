"use client";

import { Star } from "lucide-react";
import { BusinessHoursCard } from "@/components/business/profile/BusinessHoursCard";
import { BusinessSourceCard } from "@/components/business/profile/BusinessSourceCard";
import { EditPencil } from "@/components/business/profile/edit/EditPencil";
import type { BusinessPresence } from "@/lib/business/presence";
import type { Business } from "@/types/business";

type BusinessProfileSidebarProps = {
  business: Business;
  businessSlug: string;
  presence: BusinessPresence;
  initiallyRevealed?: boolean;
  isAuthenticated?: boolean;
  editMode?: boolean;
  onEditHours?: () => void;
};

/** Hours / source / Google. Map & contacts sit above this in the profile aside on lg+. */
export function BusinessProfileSidebar({
  business,
  businessSlug,
  presence,
  initiallyRevealed = false,
  isAuthenticated = false,
  editMode = false,
  onEditHours,
}: BusinessProfileSidebarProps) {
  const showHours = Boolean(business.openingHours || editMode);

  return (
    <div className="space-y-3">
      {showHours ? (
        business.openingHours ? (
          <div className="relative">
            {editMode && onEditHours ? (
              <div className="absolute right-3 top-3 z-10">
                <EditPencil label="Редактировать часы" onClick={onEditHours} />
              </div>
            ) : null}
            <BusinessHoursCard hours={business.openingHours} />
          </div>
        ) : editMode && onEditHours ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Часы работы</h2>
              <EditPencil label="Добавить часы" onClick={onEditHours} />
            </div>
            <p className="mt-2 text-sm text-slate-500">Часы ещё не указаны</p>
          </section>
        ) : null
      ) : null}

      <BusinessSourceCard
        businessSlug={businessSlug}
        editMode={editMode}
        initiallyRevealed={initiallyRevealed}
        isAuthenticated={isAuthenticated}
        presence={presence}
        presenceFlags={business.presenceFlags}
      />

      {(business.googleRating != null || business.googleReviewsCount > 0) && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Google</h2>
          <div className="mt-2 flex items-center gap-2 text-sm text-slate-700">
            <Star aria-hidden="true" className="size-4 fill-amber-500 text-amber-500" />
            {business.googleRating != null ? (
              <span className="font-semibold">{business.googleRating.toFixed(1)}</span>
            ) : null}
            {business.googleReviewsCount > 0 ? (
              <span className="text-slate-500">
                · {business.googleReviewsCount} отзывов
              </span>
            ) : null}
          </div>
        </section>
      )}
    </div>
  );
}
