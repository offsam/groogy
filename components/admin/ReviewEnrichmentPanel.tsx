"use client";

import {
  ENRICH_STAGE_LABELS,
  getPrePublishEnrichSnapshot,
  type EnrichStageState,
} from "@/lib/import-review/pre-publish-enrich";
import { scoreImportReviewQueueItem } from "@/lib/import-review/queue-completeness-score";
import { IMPORT_REVIEW_STATUS_LABELS } from "@/types/import-review";
import type { ImportReviewItem } from "@/types/import-review";

type Props = {
  item: ImportReviewItem;
};

function stageClass(state: EnrichStageState): string {
  switch (state) {
    case "done":
      return "text-emerald-700";
    case "partial":
    case "skipped":
      return "text-amber-700";
    case "failed":
      return "text-red-700";
    default:
      return "text-slate-500";
  }
}

export function ReviewEnrichmentPanel({ item }: Props) {
  const snap = getPrePublishEnrichSnapshot(item);
  const { completeness } = snap;
  const enrichScore = scoreImportReviewQueueItem(item);

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">
          Pre-publish enrich
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          P5A–P5C · auto off · CLI test only
        </p>
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Phase</dt>
          <dd className="font-medium text-slate-900">{snap.phaseLabel}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Live status</dt>
          <dd className="text-slate-800">
            {IMPORT_REVIEW_STATUS_LABELS[snap.liveStatus]}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Moderator</dt>
          <dd className="text-slate-800">
            {snap.readyForModerator ? "ready" : "waiting enrich"}
          </dd>
        </div>
      </dl>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          Stages
        </p>
        <ul className="mt-2 space-y-1.5 text-sm">
          {(
            [
              ["P5A Auto", snap.p5a],
              ["P5B AI", snap.p5b],
              ["P5C Quality", snap.p5c],
            ] as const
          ).map(([label, state]) => (
            <li key={label} className="flex justify-between gap-3">
              <span className="text-slate-700">{label}</span>
              <span className={stageClass(state)}>
                {ENRICH_STAGE_LABELS[state]}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-3">
        <div className="flex justify-between gap-3 text-sm">
          <span className="text-slate-500">Полнота</span>
          <span
            className="font-semibold tabular-nums text-slate-900"
            title="Тот же score, что в истории Обогатить"
          >
            {enrichScore}
          </span>
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Чеклист
            </p>
            <span className="text-xs font-semibold tabular-nums text-slate-800">
              {completeness.readyCount}/{completeness.total}
            </span>
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {completeness.fields.map((field) => (
              <li
                key={field.key}
                className="flex items-start justify-between gap-3"
              >
                <span className="text-slate-700">
                  {field.label}
                  {!field.ok && field.hint ? (
                    <span className="mt-0.5 block text-xs text-slate-400">
                      {field.hint}
                    </span>
                  ) : null}
                </span>
                <span
                  className={
                    field.ok
                      ? "shrink-0 text-emerald-700"
                      : "shrink-0 text-amber-700"
                  }
                >
                  {field.ok ? "есть" : "нет"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {snap.fieldSources.length > 0 ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Field sources
          </p>
          <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto text-xs">
            {snap.fieldSources.map((row) => (
              <li key={row.field} className="flex justify-between gap-2">
                <span className="text-slate-600">
                  {row.label}
                  <span className="mt-0.5 block truncate text-slate-400">
                    {row.value}
                  </span>
                </span>
                <span className="shrink-0 text-slate-800">{row.source}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            Heuristic until per-field provenance exists. Edit via Workspace →
            Edit before publish.
          </p>
        </div>
      ) : null}

      {snap.aiConfidence != null ? (
        <p className="text-xs text-slate-500">
          AI confidence:{" "}
          {Math.round(
            snap.aiConfidence <= 1
              ? snap.aiConfidence * 100
              : snap.aiConfidence,
          )}
          %
        </p>
      ) : null}
    </section>
  );
}
