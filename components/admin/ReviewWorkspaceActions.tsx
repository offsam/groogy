"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, Check, ExternalLink, GitMerge, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { signalAppNavigation } from "@/components/layout/NavigationProgress";
import {
  approveImportReviewItemAction,
  mergeImportReviewIntoExistingAction,
  setImportReviewStatusAction,
  type DuplicateMatch,
} from "@/lib/import-review/actions";
import { adminReviewBusinessClaimAction } from "@/lib/admin/claim-actions";
import {
  adminSetBusinessStatusAction,
  mergeBusinessesAction,
} from "@/lib/business/admin-actions";
import {
  approveCommentRecommendationAction,
  approveEventRecommendationAction,
  clearRecommendationDuplicateSuspicionAction,
  confirmRecommendationMergeAction,
  markRecommendationSuspectedDuplicateAction,
  rejectCommentRecommendationAction,
} from "@/lib/import-review/recommendation-actions";
import type { ReviewWorkspaceTask } from "@/lib/admin/review-workspace/types";
import { reviewWorkspacePath } from "@/lib/admin/review-workspace/task-id";
import { DuplicateMatchReasonBadge } from "@/components/admin/DuplicateMatchReasonBadge";
import type { CardMatchSignals } from "@/lib/import-review/duplicate-match-label";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

/** After Approve/Reject the workspace card must leave — back to Review inbox. */
function inboxHrefForTask(
  reviewType: ReviewWorkspaceTask["reviewType"],
  flash?: "approved" | "rejected" | "duplicate",
): string {
  const q = new URLSearchParams();
  if (reviewType === "ownership_claim") q.set("view", "claims");
  else if (reviewType === "recommendation") q.set("view", "recommendations");
  else if (reviewType === "event_verification") q.set("view", "events");
  if (flash) q.set("flash", flash);
  const qs = q.toString();
  return qs ? `/admin/review/inbox?${qs}` : "/admin/review/inbox";
}

type ActionKey =
  | "approve"
  | "reject"
  | "edit"
  | "merge"
  | "archive"
  | "openOriginal";

type ActionSpec = {
  key: ActionKey;
  label: string;
  enabled: boolean;
  comingSoon?: boolean;
  href?: string;
  variant?: "primary" | "secondary";
};

function specsFor(task: ReviewWorkspaceTask): ActionSpec[] {
  const editHref = `${reviewWorkspacePath(task.reviewType, task.sourceId)}/edit`;
  const openOriginalHref =
    task.sourceUrl || task.publicUrl || task.originalUrl;

  const canArchiveBusiness =
    task.reviewType === "ownership_claim" &&
    Boolean(
      task.payload.kind === "ownership_claim" &&
        (task.payload.business?.id || task.payload.claim.businessId),
    );

  const canMergeImport = task.reviewType === "import_review";
  const canMergeClaim =
    task.reviewType === "ownership_claim" &&
    Boolean(
      task.payload.kind === "ownership_claim" &&
        (task.payload.business?.id || task.payload.claim.businessId),
    );
  const canMergeRecommendation = task.reviewType === "recommendation";

  return [
    {
      key: "approve",
      label: "Approve",
      enabled: true,
      comingSoon: false,
      variant: "primary",
    },
    {
      key: "reject",
      label: "Reject",
      enabled: true,
      comingSoon: false,
      variant: "secondary",
    },
    {
      key: "edit",
      label: "Edit",
      enabled: true,
      comingSoon: false,
      href: editHref,
      variant: "secondary",
    },
    {
      key: "merge",
      label: "Merge",
      enabled: canMergeImport || canMergeClaim || canMergeRecommendation,
      comingSoon: !(canMergeImport || canMergeClaim || canMergeRecommendation),
      variant: "secondary",
    },
    {
      key: "archive",
      label: "Archive",
      enabled: canArchiveBusiness,
      comingSoon: !canArchiveBusiness,
      variant: "secondary",
    },
    {
      key: "openOriginal",
      label: "Open Original",
      enabled: Boolean(openOriginalHref),
      href: openOriginalHref || undefined,
      variant: "secondary",
    },
  ];
}

const ICONS: Record<ActionKey, ReactNode> = {
  approve: <Check className="size-3.5" />,
  reject: <X className="size-3.5" />,
  edit: <Pencil className="size-3.5" />,
  merge: <GitMerge className="size-3.5" />,
  archive: <Archive className="size-3.5" />,
  openOriginal: <ExternalLink className="size-3.5" />,
};

type Props = {
  task: ReviewWorkspaceTask;
};

const BUSY_LABELS: Record<string, string> = {
  approve: "Одобряю…",
  reject: "Отклоняю…",
  merge: "Объединяю…",
  archive: "Архивирую…",
  suspect: "Помечаю…",
  clear_suspicion: "Снимаю…",
  navigate: "Загрузка…",
};

export function ReviewWorkspaceActions({ task }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /** Stays set through router.push so UI does not briefly look idle. */
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const busy = pending || Boolean(busyAction);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [importDuplicates, setImportDuplicates] = useState<DuplicateMatch[]>(
    [],
  );
  const [rejectReason, setRejectReason] = useState("");
  const [moderatorNote, setModeratorNote] = useState("");
  const [showMerge, setShowMerge] = useState(false);
  const [duplicateOfItemId, setDuplicateOfItemId] = useState("");
  const recommendationItem =
    task.payload.kind === "recommendation" ? task.payload.item : null;
  const importItem =
    task.payload.kind === "import_review" ? task.payload.item : null;
  const importCardSignals: CardMatchSignals | null = importItem
    ? {
        phones: importItem.phone,
        telegramUsername: importItem.telegram_username,
        telegramUserId: importItem.telegram_user_id,
        instagram: importItem.instagram,
        website: importItem.website,
        names: [
          importItem.title,
          importItem.business_name,
          importItem.person_name,
        ].filter((x): x is string => Boolean(x?.trim())),
      }
    : null;
  const [mergeKeepId, setMergeKeepId] = useState(
    recommendationItem?.duplicate_of_entity_id || "",
  );
  const [mergeKeepType, setMergeKeepType] = useState<
    "professional" | "business"
  >(
    recommendationItem?.duplicate_of_entity_type === "business"
      ? "business"
      : "professional",
  );
  const [mergeDropId, setMergeDropId] = useState(
    task.payload.kind === "ownership_claim"
      ? task.payload.business?.id || task.payload.claim.businessId
      : "",
  );

  const actions = specsFor(task);
  const isSuspected =
    recommendationItem?.status === "suspected_duplicate" ||
    Boolean(recommendationItem?.duplicate_of_entity_id);

  function leaveToInbox(flash?: "approved" | "rejected" | "duplicate") {
    setBusyAction("navigate");
    if (flash === "rejected") {
      setMessage("Отклонено — возвращаю в inbox…");
    } else if (flash === "duplicate") {
      setMessage("Дубль — возвращаю в inbox…");
    } else if (flash === "approved") {
      setMessage("Одобрено — возвращаю в inbox…");
    } else {
      setMessage("Возвращаю в inbox…");
    }
    signalAppNavigation();
    router.push(inboxHrefForTask(task.reviewType, flash));
    router.refresh();
  }

  function run(action: ActionKey) {
    setError(null);
    setMessage(null);

    if (action === "merge") {
      setShowMerge((v) => !v);
      return;
    }

    setBusyAction(action);
    startTransition(async () => {
      try {
        if (task.reviewType === "import_review") {
          if (action === "approve") {
            const res = await approveImportReviewItemAction({
              id: task.sourceId,
            });
            if (!res.ok) {
              setError(res.message || "Approve failed");
              setImportDuplicates(res.duplicates ?? []);
              return;
            }
            setImportDuplicates([]);
            leaveToInbox("approved");
            return;
          }
          if (action === "reject") {
            const res = await setImportReviewStatusAction({
              id: task.sourceId,
              status: "rejected",
              rejectReason: rejectReason.trim() || "other",
              notes: moderatorNote.trim() || undefined,
            });
            if (!res.ok) {
              setError(res.message || "Reject failed");
              return;
            }
            leaveToInbox("rejected");
            return;
          }
        }

        if (task.reviewType === "ownership_claim") {
          if (action === "approve" || action === "reject") {
            const res = await adminReviewBusinessClaimAction({
              claimId: task.sourceId,
              decision: action === "approve" ? "approved" : "rejected",
              moderatorNote: moderatorNote.trim() || null,
            });
            if (!res.ok) {
              setError(res.message);
              return;
            }
            leaveToInbox(action === "approve" ? "approved" : "rejected");
            return;
          }
          if (action === "archive") {
            const businessId =
              task.payload.kind === "ownership_claim"
                ? task.payload.business?.id || task.payload.claim.businessId
                : null;
            if (!businessId) {
              setError("Business id missing");
              return;
            }
            const res = await adminSetBusinessStatusAction({
              businessId,
              status: "archived",
              slug:
                task.payload.kind === "ownership_claim"
                  ? task.payload.claim.businessSlug
                  : null,
            });
            if (!res.ok) {
              setError(res.message);
              return;
            }
            setMessage("Business archived");
            leaveToInbox();
            return;
          }
        }

        if (task.reviewType === "recommendation") {
          if (action === "approve") {
            const res = await approveCommentRecommendationAction({
              id: task.sourceId,
            });
            if (!res.ok) {
              setError(res.message || "Approve failed");
              if (res.duplicateCandidate) {
                setMergeKeepId(res.duplicateCandidate.entityId);
                setMergeKeepType(res.duplicateCandidate.entityType);
                setShowMerge(true);
              }
              router.refresh();
              return;
            }
            leaveToInbox("approved");
            return;
          }
          if (action === "reject") {
            const res = await rejectCommentRecommendationAction({
              id: task.sourceId,
            });
            if (!res.ok) {
              setError(res.message || "Reject failed");
              return;
            }
            leaveToInbox("rejected");
            return;
          }
        }

        if (task.reviewType === "event_verification") {
          if (action === "approve") {
            const res = await approveEventRecommendationAction({
              id: task.sourceId,
            });
            if (!res.ok) {
              setError(res.message || "Approve failed");
              return;
            }
            leaveToInbox("approved");
            return;
          }
          if (action === "reject") {
            const res = await rejectCommentRecommendationAction({
              id: task.sourceId,
            });
            if (!res.ok) {
              setError(res.message || "Reject failed");
              return;
            }
            leaveToInbox("rejected");
            return;
          }
        }

        setError("Action not available for this task type");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unexpected error");
      } finally {
        setBusyAction((cur) => (cur === action ? null : cur));
      }
    });
  }

  function runMerge() {
    setError(null);
    setMessage(null);
    setBusyAction("merge");
    startTransition(async () => {
      try {
        if (task.reviewType === "import_review") {
          const res = await setImportReviewStatusAction({
            id: task.sourceId,
            status: "duplicate",
            notes: moderatorNote.trim() || undefined,
            duplicateOfItemId: duplicateOfItemId.trim() || undefined,
          });
          if (!res.ok) {
            setError(res.message || "Merge failed");
            return;
          }
          setMessage(res.message || "Marked as duplicate");
          setShowMerge(false);
          leaveToInbox("duplicate");
          return;
        }

        if (task.reviewType === "ownership_claim") {
          const keep = mergeKeepId.trim();
          const drop = mergeDropId.trim();
          if (!keep || !drop || keep === drop) {
            setError("Укажите разные keepId и dropId");
            return;
          }
          const res = await mergeBusinessesAction({
            keepId: keep,
            dropId: drop,
            dropSlug:
              task.payload.kind === "ownership_claim"
                ? task.payload.claim.businessSlug
                : null,
          });
          if (!res.ok) {
            setError(res.message);
            return;
          }
          setMessage(res.message || "Merged");
          setShowMerge(false);
          router.refresh();
          return;
        }

        if (task.reviewType === "recommendation") {
          const keep = mergeKeepId.trim();
          const res = await confirmRecommendationMergeAction({
            id: task.sourceId,
            entityType: keep ? mergeKeepType : undefined,
            entityId: keep || undefined,
          });
          if (!res.ok) {
            setError(res.message || "Merge failed");
            return;
          }
          setMessage(res.message || "Merged");
          setShowMerge(false);
          router.refresh();
          return;
        }

        setError("Merge not available");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unexpected error");
      } finally {
        setBusyAction((cur) => (cur === "merge" ? null : cur));
      }
    });
  }

  function runSuspect() {
    setError(null);
    setMessage(null);
    setBusyAction("suspect");
    startTransition(async () => {
      try {
        const keep = mergeKeepId.trim();
        const res = await markRecommendationSuspectedDuplicateAction({
          id: task.sourceId,
          entityType: keep ? mergeKeepType : undefined,
          entityId: keep || undefined,
          reason: moderatorNote.trim() || undefined,
        });
        if (!res.ok) {
          setError(res.message || "Не удалось пометить");
          return;
        }
        if (res.duplicateCandidate) {
          setMergeKeepId(res.duplicateCandidate.entityId);
          setMergeKeepType(res.duplicateCandidate.entityType);
        } else if (res.publishedEntityId && res.publishedEntityType) {
          setMergeKeepId(res.publishedEntityId);
          setMergeKeepType(
            res.publishedEntityType === "business"
              ? "business"
              : "professional",
          );
        }
        setMessage(res.message || "Помечено как подозрение на дубликат");
        setShowMerge(true);
        router.refresh();
      } finally {
        setBusyAction((cur) => (cur === "suspect" ? null : cur));
      }
    });
  }

  function runClearSuspicion() {
    setError(null);
    setMessage(null);
    setBusyAction("clear_suspicion");
    startTransition(async () => {
      try {
        const res = await clearRecommendationDuplicateSuspicionAction({
          id: task.sourceId,
        });
        if (!res.ok) {
          setError(res.message || "Не удалось снять подозрение");
          return;
        }
        setMessage(res.message || "Подозрение снято");
        router.refresh();
      } finally {
        setBusyAction((cur) => (cur === "clear_suspicion" ? null : cur));
      }
    });
  }

  const needsNote =
    task.reviewType === "ownership_claim" ||
    task.reviewType === "import_review";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Модерация</h2>
      <p className="mt-1 text-xs text-slate-500">
        Действия вызывают существующие handlers. Workspace сам ничего не пишет в
        БД.
      </p>

      {needsNote ? (
        <div className="mt-3 space-y-2">
          {task.reviewType === "import_review" ? (
            <label className="block text-xs font-medium text-slate-500">
              Reject reason
              <input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="spam | other | …"
                className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
              />
            </label>
          ) : null}
          <label className="block text-xs font-medium text-slate-500">
            Note
            <textarea
              value={moderatorNote}
              onChange={(e) => setModeratorNote(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
            />
          </label>
        </div>
      ) : null}

      {recommendationItem &&
      (isSuspected ||
        recommendationItem.duplicate_of_entity_id ||
        recommendationItem.duplicate_reason) ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p className="font-medium">Подозрение на дубликат</p>
          <p className="mt-1 text-xs text-amber-900/80">
            {recommendationItem.duplicate_reason || "candidate"}
            {recommendationItem.duplicate_of_entity_type
              ? ` · ${recommendationItem.duplicate_of_entity_type}`
              : ""}
            {recommendationItem.duplicate_of_entity_id
              ? ` · ${recommendationItem.duplicate_of_entity_id}`
              : ""}
          </p>
          {recommendationItem.duplicate_of_entity_id &&
          recommendationItem.duplicate_of_entity_type ? (
            <Link
              className="mt-1 inline-block text-xs font-medium text-brand-blue hover:underline"
              href={
                recommendationItem.duplicate_of_entity_type === "professional"
                  ? `/admin/catalog/professionals?q=${recommendationItem.duplicate_of_entity_id}`
                  : `/admin/catalog/businesses?q=${recommendationItem.duplicate_of_entity_id}`
              }
            >
              Открыть кандидата в каталоге
            </Link>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {busy ? (
        <p
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-brand-blue/25 bg-brand-blue/5 px-3 py-2 text-sm text-brand-blue-deep"
          role="status"
          aria-live="polite"
        >
          <BrandPinLoader size="sm" />
          {BUSY_LABELS[busyAction ?? ""] || message || "Обрабатываю…"}
        </p>
      ) : null}

      {importDuplicates.length > 0 ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p className="font-medium">Найденные совпадения</p>
          <p className="mt-1 text-xs text-amber-900/80">
            Объединить — влить в существующую. Отклонить — закрыть как дубль
            без слияния. Или одобрить как новую.
          </p>
          <ul className="mt-2 space-y-2 text-xs">
            {importDuplicates.map((d) => {
              const href =
                d.kind === "business"
                  ? d.slug
                    ? `/business/${d.slug}`
                    : `/admin/catalog/businesses?q=${d.id}`
                  : d.kind === "professional"
                    ? d.slug
                      ? `/professional/${d.slug}`
                      : `/admin/catalog/professionals?q=${d.id}`
                  : d.kind === "import_item"
                    ? `/admin/review/workspace/import_review/${d.id}`
                    : d.kind === "recommendation"
                      ? `/admin/review/${encodeURIComponent(`recommendation:${d.id}`)}`
                      : `/admin/catalog/marketplace?q=${d.id}`;
              const preview = d.mergePreview;
              return (
                <li
                  key={`${d.kind}-${d.id}`}
                  className="rounded-lg border border-amber-200/80 bg-white/70 px-2.5 py-2"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">
                        {d.title || d.id}
                        {d.businessStatus === "archived" ? (
                          <span className="ml-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
                            архив
                          </span>
                        ) : null}
                      </p>
                      <p className="text-[11px] text-amber-900/70">
                        {d.kind === "business"
                          ? "бизнес"
                          : d.kind === "professional"
                            ? "специалист"
                            : d.kind === "import_item"
                              ? d.queueOpen
                                ? "очередь"
                                : "импорт"
                              : d.kind === "recommendation"
                                ? "рекомендация"
                                : d.kind}
                        {d.businessStatus === "archived"
                          ? " · при объединении вернём из архива"
                          : ""}
                      </p>
                      <DuplicateMatchReasonBadge
                        reason={d.reason}
                        card={importCardSignals}
                      />
                      {preview ? (
                        <div className="mt-2 space-y-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-700">
                          <p className="font-medium text-slate-800">
                            При объединении
                          </p>
                          <p>{preview.summary}</p>
                          {preview.willAdd.length > 0 ? (
                            <p>
                              <span className="font-medium text-emerald-800">
                                Добавит:
                              </span>{" "}
                              {preview.willAdd.join("; ")}
                            </p>
                          ) : (
                            <p className="text-slate-500">
                              Новых полей не добавит
                            </p>
                          )}
                          {preview.willSkip.length > 0 ? (
                            <p className="text-slate-500">
                              Не тронет: {preview.willSkip.join("; ")}
                            </p>
                          ) : null}
                          <p>{preview.queueEffect}</p>
                        </div>
                      ) : null}
                      <Link
                        className="mt-1 inline-block font-medium text-brand-blue hover:underline"
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Открыть
                      </Link>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1.5">
                      <Button
                        type="button"
                        className="px-2.5 py-1 text-xs"
                        loading={busy && busyAction === "merge"}
                        disabled={busy}
                        onClick={() => {
                          setError(null);
                          setMessage(null);
                          setBusyAction("merge");
                          startTransition(async () => {
                            try {
                              const res =
                                await mergeImportReviewIntoExistingAction({
                                  id: task.sourceId,
                                  matchKind: d.kind,
                                  matchId: d.id,
                                  matchTitle: d.title,
                                  matchReason: d.reason,
                                  matchSlug: d.slug,
                                });
                              if (!res.ok) {
                                setError(res.message || "Merge failed");
                                return;
                              }
                              setImportDuplicates([]);
                              setMessage(res.message || "Объединено");
                              router.refresh();
                            } catch (err) {
                              setError(
                                err instanceof Error
                                  ? err.message
                                  : "Не удалось объединить",
                              );
                            } finally {
                              setBusyAction((cur) =>
                                cur === "merge" ? null : cur,
                              );
                            }
                          });
                        }}
                      >
                        {busy && busyAction === "merge" ? null : (
                          <GitMerge className="size-3.5" />
                        )}
                        {busy && busyAction === "merge"
                          ? BUSY_LABELS.merge
                          : "Объединить"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="px-2.5 py-1 text-xs"
                        loading={busy && busyAction === "reject"}
                        disabled={busy}
                        onClick={() => {
                          setError(null);
                          setMessage(null);
                          setBusyAction("reject");
                          startTransition(async () => {
                            try {
                              const res =
                                d.kind === "import_item"
                                  ? await setImportReviewStatusAction({
                                      id: task.sourceId,
                                      status: "duplicate",
                                      duplicateOfItemId: d.id,
                                      notes: `Отклонён как дубль: ${d.reason || ""}`,
                                    })
                                  : await setImportReviewStatusAction({
                                      id: task.sourceId,
                                      status: "duplicate",
                                      duplicateOfEntityType: d.kind,
                                      duplicateOfEntityId: d.id,
                                      notes: `Отклонён как дубль ${d.kind}: ${d.reason || ""}`,
                                    });
                              if (!res.ok) {
                                setError(res.message || "Reject failed");
                                return;
                              }
                              setImportDuplicates([]);
                              setMessage(
                                res.message || "Отклонено как дубль",
                              );
                              leaveToInbox("duplicate");
                            } catch (err) {
                              setError(
                                err instanceof Error
                                  ? err.message
                                  : "Не удалось отклонить",
                              );
                            } finally {
                              setBusyAction((cur) =>
                                cur === "reject" ? null : cur,
                              );
                            }
                          });
                        }}
                      >
                        {busy && busyAction === "reject" ? null : (
                          <X className="size-3.5" />
                        )}
                        {busy && busyAction === "reject"
                          ? BUSY_LABELS.reject
                          : "Отклонить"}
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              className="min-h-10 text-xs sm:min-h-0"
              loading={busy && busyAction === "approve"}
              disabled={busy}
              onClick={() => {
                setError(null);
                setMessage(null);
                setBusyAction("approve");
                startTransition(async () => {
                  try {
                    const res = await approveImportReviewItemAction({
                      id: task.sourceId,
                      force: true,
                    });
                    if (!res.ok) {
                      setError(res.message || "Approve failed");
                      setImportDuplicates(res.duplicates ?? []);
                      return;
                    }
                    setImportDuplicates([]);
                    leaveToInbox("approved");
                  } finally {
                    setBusyAction((cur) => (cur === "approve" ? null : cur));
                  }
                });
              }}
            >
              {busy && busyAction === "approve" ? null : (
                <Check className="size-3.5" />
              )}
              {busy && busyAction === "approve"
                ? BUSY_LABELS.approve
                : "Одобрить как новую"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="min-h-10 text-xs sm:min-h-0"
              disabled={busy}
              onClick={() => setImportDuplicates([])}
            >
              Скрыть список
            </Button>
          </div>
        </div>
      ) : null}

      {message ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {actions.map((action) => {
          if (action.key === "edit" || action.key === "openOriginal") {
            if (!action.enabled || !action.href) {
              return (
                <Button
                  key={action.key}
                  type="button"
                  variant="secondary"
                  disabled
                  title="Coming Soon"
                  className="min-h-10 gap-1.5 max-sm:w-full sm:min-h-0"
                >
                  {ICONS[action.key]}
                  {action.label}
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">
                    Soon
                  </span>
                </Button>
              );
            }
            return (
              <Link
                key={action.key}
                className="max-sm:contents"
                href={action.href}
                target={action.key === "openOriginal" ? "_blank" : undefined}
                rel="noreferrer"
              >
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-10 gap-1.5 max-sm:w-full sm:min-h-0"
                >
                  {ICONS[action.key]}
                  {action.label}
                </Button>
              </Link>
            );
          }

          if (!action.enabled || action.comingSoon) {
            return (
              <Button
                key={action.key}
                type="button"
                variant={action.variant}
                disabled
                title="Coming Soon"
                className="min-h-10 gap-1.5 max-sm:w-full sm:min-h-0"
              >
                {ICONS[action.key]}
                {action.label}
                <span className="text-[10px] uppercase tracking-wide text-slate-400">
                  Soon
                </span>
              </Button>
            );
          }

          return (
            <Button
              key={action.key}
              type="button"
              variant={action.variant}
              loading={busy && busyAction === action.key}
              disabled={busy}
              onClick={() => run(action.key)}
              className={`min-h-10 max-sm:w-full sm:min-h-0 ${
                action.key === "reject"
                  ? "border-red-200 text-red-700 hover:bg-red-50"
                  : ""
              }`}
            >
              {busy && busyAction === action.key
                ? null
                : ICONS[action.key]}
              {busy && busyAction === action.key
                ? BUSY_LABELS[action.key] || action.label
                : action.label}
            </Button>
          );
        })}
      </div>

      {task.reviewType === "recommendation" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            loading={busy && busyAction === "suspect"}
            disabled={busy}
            onClick={runSuspect}
            className="min-h-10 text-amber-800"
          >
            {busy && busyAction === "suspect"
              ? BUSY_LABELS.suspect
              : "Подозрение на дубликат"}
          </Button>
          {isSuspected ? (
            <Button
              type="button"
              variant="secondary"
              loading={busy && busyAction === "clear_suspicion"}
              disabled={busy}
              onClick={runClearSuspicion}
              className="min-h-10"
            >
              {busy && busyAction === "clear_suspicion"
                ? BUSY_LABELS.clear_suspicion
                : "Не дубликат"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {showMerge ? (
        <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Merge
          </p>
          {task.reviewType === "import_review" ? (
            <label className="block text-xs font-medium text-slate-500">
              Duplicate of import item id (optional)
              <input
                value={duplicateOfItemId}
                onChange={(e) => setDuplicateOfItemId(e.target.value)}
                placeholder="uuid"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
              />
            </label>
          ) : null}
          {task.reviewType === "ownership_claim" ? (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-500">
                Keep business id
                <input
                  value={mergeKeepId}
                  onChange={(e) => setMergeKeepId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
                />
              </label>
              <label className="block text-xs font-medium text-slate-500">
                Drop business id (archive duplicate)
                <input
                  value={mergeDropId}
                  onChange={(e) => setMergeDropId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
                />
              </label>
            </div>
          ) : null}
          {task.reviewType === "recommendation" ? (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-500">
                Keep entity type
                <select
                  value={mergeKeepType}
                  onChange={(e) =>
                    setMergeKeepType(
                      e.target.value === "business"
                        ? "business"
                        : "professional",
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
                >
                  <option value="professional">professional</option>
                  <option value="business">business</option>
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-500">
                Keep entity id (optional — auto-match if empty)
                <input
                  value={mergeKeepId}
                  onChange={(e) => setMergeKeepId(e.target.value)}
                  placeholder="uuid live карточки"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
                />
              </label>
              <p className="text-xs text-slate-500">
                Confirm merge = fill-empty в живую карточку и status=merged.
              </p>
            </div>
          ) : null}
          <Button
            type="button"
            loading={busy && busyAction === "merge"}
            disabled={busy}
            onClick={runMerge}
          >
            {busy && busyAction === "merge" ? null : (
              <GitMerge className="size-3.5" />
            )}
            {busy && busyAction === "merge"
              ? BUSY_LABELS.merge
              : task.reviewType === "recommendation"
                ? "Это дубликат → смешать"
                : "Confirm merge"}
          </Button>
        </div>
      ) : null}

      <p className="mt-3 text-[11px] text-slate-400">
        Type: {task.reviewType}
      </p>
    </section>
  );
}
