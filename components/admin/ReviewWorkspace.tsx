"use client";

import Link from "next/link";
import { ReviewEnrichmentPanel } from "@/components/admin/ReviewEnrichmentPanel";
import { ReviewEventPendingPanel } from "@/components/admin/ReviewEventPendingPanel";
import { ReviewHubPreviewPanel } from "@/components/admin/ReviewHubPreviewPanel";
import { ReviewChangeEntityTypePanel } from "@/components/admin/ReviewChangeEntityTypePanel";
import { ReviewLocationUnresolvedBanner } from "@/components/admin/ReviewLocationUnresolvedBanner";
import { ReviewWorkspaceActions } from "@/components/admin/ReviewWorkspaceActions";
import { ReviewWorkspaceCard } from "@/components/admin/ReviewWorkspaceCard";
import { ReviewWorkspaceQueueNav } from "@/components/admin/ReviewWorkspaceQueueNav";
import type { ReviewWorkspaceTask } from "@/lib/admin/review-workspace/types";
import {
  INBOX_ENTITY_LABELS,
  INBOX_REVIEW_TYPE_LABELS,
  INBOX_SOURCE_LABELS,
} from "@/lib/admin/inbox/labels";
import { resolveReviewWorkflowPhase, REVIEW_WORKFLOW_PHASE_LABELS, importReviewCompleteness } from "@/lib/import-review/pre-publish-enrich";
import { scoreImportReviewQueueItem } from "@/lib/import-review/queue-completeness-score";
import type { ReviewCategoryOption } from "@/lib/import-review/category-options";

type Props = {
  task: ReviewWorkspaceTask;
  categories?: ReviewCategoryOption[];
};

function formatConfidence(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  const pct = value <= 1 ? value * 100 : value;
  return `${Math.round(pct)}%`;
}

function formatDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ReviewWorkspace({ task, categories = [] }: Props) {
  const { meta } = task;
  const importItem =
    task.payload.kind === "import_review" ? task.payload.item : null;
  const workflowPhase = importItem
    ? resolveReviewWorkflowPhase(importItem)
    : null;
  const fillReport = importItem ? importReviewCompleteness(importItem) : null;
  const enrichScore = importItem
    ? scoreImportReviewQueueItem(importItem)
    : null;

  return (
    <div className="space-y-4 pb-16 sm:space-y-5 sm:pb-0">
      {/* Header */}
      <header className="space-y-2 border-b border-slate-200 pb-3 sm:space-y-3 sm:pb-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            href="/admin/review/inbox"
            className="text-brand-blue hover:underline"
          >
            ← Inbox
          </Link>
          <Link
            href={task.originalUrl}
            className="hidden text-slate-500 hover:underline sm:inline"
          >
            Legacy (compat)
          </Link>
        </div>
        <div>
          <p className="text-xs font-medium text-brand-blue-deep sm:text-sm">
            Review Center · Workspace
          </p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {meta.title}
          </h1>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-500">
            <span>{INBOX_REVIEW_TYPE_LABELS[meta.reviewType]}</span>
            <span>{INBOX_ENTITY_LABELS[meta.entityType]}</span>
            <span>
              {INBOX_SOURCE_LABELS[meta.source]}
              {meta.sourceName ? ` · ${meta.sourceName}` : ""}
            </span>
            <span className="uppercase tracking-wide">{meta.status}</span>
            {workflowPhase ? (
              <span className="text-brand-blue">
                {REVIEW_WORKFLOW_PHASE_LABELS[workflowPhase]}
              </span>
            ) : null}
          </p>
        </div>
      </header>

      <div className="grid min-w-0 gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Main card */}
        <section className="min-w-0 space-y-3 overflow-x-hidden">
          {importItem ? (
            <ReviewHubPreviewPanel
              categories={categories}
              inboxPriority={meta.priority}
              item={importItem}
            />
          ) : (
            <div className="min-w-0 overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-3 sm:rounded-2xl sm:p-5">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Public card preview
              </p>
              <div className="min-w-0 overflow-hidden">
                <ReviewWorkspaceCard task={task} />
              </div>
            </div>
          )}

          <ReviewWorkspaceActions task={task} />
          {importItem ? (
            <ReviewLocationUnresolvedBanner
              city={importItem.city}
              countyGeoid={importItem.county_geoid}
              state={importItem.state}
            />
          ) : null}
          {importItem ? <ReviewChangeEntityTypePanel item={importItem} /> : null}
        </section>

        {/* Sidebar */}
        <aside className="space-y-4">
          {importItem ? <ReviewEnrichmentPanel item={importItem} /> : null}

          {task.payload.kind === "event_verification" ? (
            <ReviewEventPendingPanel item={task.payload.item} />
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Контекст</h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Task ID</dt>
                <dd className="truncate font-mono text-xs text-slate-800">
                  {task.taskId}
                </dd>
              </div>
              {enrichScore != null ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Полнота</dt>
                  <dd className="font-semibold tabular-nums text-slate-900">
                    {enrichScore}
                  </dd>
                </div>
              ) : null}
              {fillReport ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Чеклист</dt>
                  <dd className="font-semibold tabular-nums text-slate-900">
                    {fillReport.readyCount}/{fillReport.total}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">AI confidence</dt>
                <dd className="text-slate-800">
                  {formatConfidence(meta.aiConfidence)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Created</dt>
                <dd className="text-slate-800">{formatDate(meta.createdAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Priority</dt>
                <dd className="text-slate-800">{meta.priority}</dd>
              </div>
            </dl>
          </section>

          {task.payload.kind === "ownership_claim" ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Заявитель</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Имя</dt>
                  <dd className="text-slate-800">
                    {task.payload.claim.applicantDisplayName || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Email</dt>
                  <dd className="text-slate-800">
                    {task.payload.claim.applicantEmail || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Метод</dt>
                  <dd className="text-slate-800">
                    {task.payload.claim.verificationMethod || "—"}
                  </dd>
                </div>
                {task.payload.claim.applicantMessage ? (
                  <div>
                    <dt className="text-xs text-slate-500">Сообщение</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-slate-700">
                      {task.payload.claim.applicantMessage}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>
          ) : null}

          {task.payload.kind === "import_review" &&
          task.payload.item.source_text ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">
                Исходный текст
              </h2>
              <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm text-slate-700">
                {task.payload.item.source_text}
              </p>
            </section>
          ) : null}

          {(task.payload.kind === "recommendation" ||
            task.payload.kind === "event_verification") &&
          task.payload.item.comment_texts?.length ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">
                Комментарии
              </h2>
              <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto text-sm text-slate-700">
                {task.payload.item.comment_texts.slice(0, 5).map((text, i) => (
                  <li
                    key={i}
                    className="rounded-lg bg-slate-50 px-3 py-2 whitespace-pre-wrap"
                  >
                    {text}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>

      <ReviewWorkspaceQueueNav taskId={task.taskId} />
    </div>
  );
}
