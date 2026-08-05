"use client";

import { cn } from "@/lib/utils";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

const chip =
  "inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

type Props = {
  /** Primary publish / approve. */
  onPublish?: () => void;
  publishLabel?: string;
  publishPending?: boolean;
  publishDisabled?: boolean;
  /** Shown next to Админ — default «Не опубликовано». */
  statusLabel?: string;
  /** Pre-publish enrich control (panel/button from parent). */
  enrichSlot?: React.ReactNode;
  /** Paste enrich control. */
  pasteSlot?: React.ReactNode;
  /** Extra chips (hub switch hint, etc.). */
  extraSlot?: React.ReactNode;
  className?: string;
};

/**
 * Amber admin strip for queue / import previews — same chrome as live
 * AdminLensBar, but actions that work before publish (Опубликовать, enrich).
 * Used on every admin Review preview, any hub / source.
 */
export function AdminQueueLensBar({
  onPublish,
  publishLabel = "Опубликовать",
  publishPending = false,
  publishDisabled = false,
  statusLabel = "Не опубликовано",
  enrichSlot,
  pasteSlot,
  extraSlot,
  className,
}: Props) {
  return (
    <div
      aria-label="Управление карточкой (админ, очередь)"
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-xl border border-amber-200/80 bg-amber-50/60 px-3 py-2",
        className,
      )}
    >
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800/80">
        Админ
      </span>

      {statusLabel ? (
        <span className="rounded-full border border-amber-300/80 bg-amber-100/80 px-2.5 py-1 text-[11px] font-medium text-amber-950">
          {statusLabel}
        </span>
      ) : null}

      {onPublish ? (
        <button
          type="button"
          aria-busy={publishPending || undefined}
          className={cn(
            chip,
            "border-brand-blue/40 bg-brand-blue text-white hover:bg-brand-blue/90 hover:text-white disabled:opacity-80",
            publishPending &&
              "pointer-events-none ring-2 ring-brand-blue/35 ring-offset-1 ring-offset-amber-50",
          )}
          disabled={publishDisabled || publishPending}
          onClick={onPublish}
        >
          {publishPending ? (
            <>
              <BrandPinLoader size="sm" />
              Публикую…
            </>
          ) : (
            publishLabel
          )}
        </button>
      ) : null}

      {enrichSlot}
      {pasteSlot}
      {extraSlot}
    </div>
  );
}
