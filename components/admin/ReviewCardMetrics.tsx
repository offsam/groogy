"use client";

import {
  CONTACT_LEVEL_LABELS,
  CONTACT_LEVEL_STYLES,
  computeContactPriorityScore,
  getContactFlags,
  getContactLevel,
} from "@/lib/import-review/contacts";
import { importReviewCompleteness } from "@/lib/import-review/pre-publish-enrich";
import { scoreImportReviewQueueItem } from "@/lib/import-review/queue-completeness-score";
import type { ImportReviewItem } from "@/types/import-review";

type Props = {
  item: ImportReviewItem;
  /** Inbox / workspace priority (0–100), when known. */
  inboxPriority?: number | null;
  /**
   * Phone strip next to the title — chips only, no layout growth.
   * Full panel stays for sm+.
   */
  compact?: boolean;
  className?: string;
};

function formatAiConfidence(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const pct = value <= 1 ? value * 100 : value;
  return `${Math.round(pct)}%`;
}

/**
 * Queue metrics for the review card.
 * `compact` = one truncated chip row (phone); default = full panel (desktop).
 */
export function ReviewCardMetrics({
  item,
  inboxPriority = null,
  compact = false,
  className = "",
}: Props) {
  const completeness = importReviewCompleteness(item);
  const enrichScore = scoreImportReviewQueueItem(item);
  const contactLevel = getContactLevel(item);
  const contactPriority = computeContactPriorityScore(getContactFlags(item));
  const aiPct = formatAiConfidence(item.ai_confidence);

  if (compact) {
    return (
      <div
        className={`flex min-w-0 max-w-[52%] shrink-0 items-center justify-end gap-1 overflow-hidden text-[10px] font-semibold tabular-nums leading-none text-slate-600 ${className}`}
        title={`Полнота ${enrichScore} · Чеклист ${completeness.readyCount}/${completeness.total} · AI ${aiPct}${
          inboxPriority != null ? ` · P${inboxPriority}` : ""
        }`}
      >
        <span
          className="rounded bg-emerald-50 px-1 py-0.5 text-emerald-800"
          title="Полнота"
        >
          {enrichScore}
        </span>
        <span
          className="rounded bg-slate-100 px-1 py-0.5"
          title="Чеклист"
        >
          {completeness.readyCount}/{completeness.total}
        </span>
        <span className="rounded bg-slate-100 px-1 py-0.5">AI {aiPct}</span>
        {inboxPriority != null ? (
          <span className="rounded bg-slate-100 px-1 py-0.5">
            P{inboxPriority}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white px-3 py-2.5 ${className}`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        Метрики карточки
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <dt className="text-[11px] text-slate-500">Полнота</dt>
          <dd className="text-sm font-semibold tabular-nums text-slate-900">
            {enrichScore}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-500">Чеклист</dt>
          <dd className="text-sm font-semibold tabular-nums text-slate-900">
            {completeness.readyCount}/{completeness.total}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-500">AI confidence</dt>
          <dd className="text-sm font-semibold tabular-nums text-slate-900">
            {aiPct}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-500">Контакты</dt>
          <dd className="mt-0.5">
            <span
              className={`inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${CONTACT_LEVEL_STYLES[contactLevel]}`}
            >
              {CONTACT_LEVEL_LABELS[contactLevel]}
            </span>
            <span className="ml-1.5 text-xs tabular-nums text-slate-500">
              pri {contactPriority}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-500">Inbox priority</dt>
          <dd className="text-sm font-semibold tabular-nums text-slate-900">
            {inboxPriority != null ? inboxPriority : "—"}
          </dd>
        </div>
      </dl>
      {item.ai_decision ? (
        <p className="mt-2 truncate text-xs text-slate-500">
          AI decision:{" "}
          <span className="font-medium text-slate-700">{item.ai_decision}</span>
          {item.ai_reason ? (
            <span className="text-slate-400"> · {item.ai_reason}</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
