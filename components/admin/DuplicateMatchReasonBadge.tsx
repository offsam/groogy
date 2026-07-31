import { cn } from "@/lib/utils";
import {
  parseDuplicateMatchReason,
  type CardMatchSignals,
} from "@/lib/import-review/duplicate-match-label";

type Props = {
  reason: string;
  /** Optional fields from the current queue card — used for «есть на этой карточке». */
  card?: CardMatchSignals | null;
  className?: string;
  /** Extra line after the badge (e.g. archive note). */
  extra?: string | null;
};

/** Prominent match-signal badge for duplicate scan rows. */
export function DuplicateMatchReasonBadge({
  reason,
  card,
  className,
  extra,
}: Props) {
  const label = parseDuplicateMatchReason(reason, card);
  return (
    <div className={cn("mt-1.5 space-y-0.5", className)}>
      <p
        className={cn(
          "inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 rounded-md px-2 py-1 text-[11px] font-semibold leading-snug",
          label.exact
            ? "bg-amber-100 text-amber-950 ring-1 ring-amber-300/80"
            : "bg-slate-100 text-slate-800 ring-1 ring-slate-200",
        )}
        title={reason}
      >
        <span>{label.kindLabelRu}</span>
        {label.valueLabel ? (
          <span
            className={cn(
              "font-bold",
              label.exact ? "text-amber-950" : "text-slate-900",
            )}
          >
            {label.valueLabel}
          </span>
        ) : null}
      </p>
      {label.onThisCardHint ? (
        <p className="text-[10px] font-medium text-emerald-800">
          {label.onThisCardHint}
        </p>
      ) : null}
      {extra ? (
        <p className="text-[10px] text-amber-900/70">{extra}</p>
      ) : null}
    </div>
  );
}
