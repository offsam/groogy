"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import { SupportRequestModal } from "@/components/support/SupportRequestModal";
import { cn } from "@/lib/utils";

type ReportEntityButtonProps = {
  /** Route-segment-style identifier, e.g. "business", "professional", "listing". */
  entityType: string;
  entityId: string;
  entityName: string;
  className?: string;
};

/**
 * Small "report this card" flag icon, meant to sit in a card's corner
 * (same slot as FavoriteButton where one exists). Cards are wrapped in
 * <Link>, so this always stops propagation/prevents default to avoid
 * navigating away when clicked.
 */
export function ReportEntityButton({
  entityType,
  entityId,
  entityName,
  className,
}: ReportEntityButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        aria-label="Пожаловаться на карточку"
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-400 shadow-sm backdrop-blur transition hover:border-rose-200 hover:text-rose-600",
          className,
        )}
        title="Пожаловаться"
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Flag aria-hidden="true" className="size-3.5" />
      </button>

      <SupportRequestModal
        description="Расскажите, что не так с этой карточкой — неверные данные, подозрение на мошенничество, объявление больше не актуально и т.п."
        entityId={entityId}
        entityName={entityName}
        entityType={entityType}
        open={open}
        placeholder="Опишите проблему…"
        reportType="complaint"
        title="Пожаловаться"
        onClose={() => setOpen(false)}
      />
    </>
  );
}
