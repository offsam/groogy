"use client";

import { useTransition, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import {
  adminSetReportStatusAction,
  adminSetReviewModerationAction,
} from "@/lib/reviews/actions";
import { AuthAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import type {
  Review,
  ReviewModerationStatus,
  ReviewReport,
  ReviewVerificationSession,
} from "@/types/review";
import {
  MODERATION_STATUS_LABELS,
  REVIEW_REPORT_REASON_LABELS,
} from "@/types/review";

const FILTERS: Array<{ id: ReviewModerationStatus | "reported"; label: string }> = [
  { id: "manual_review", label: "Manual review" },
  { id: "published", label: "Published" },
  { id: "hidden", label: "Hidden" },
  { id: "rejected", label: "Rejected" },
  { id: "expired", label: "Expired" },
  { id: "reported", label: "Reported" },
];

export function AdminReviewsPanel({
  filter,
  reviews,
  openReports,
  sessionsByReviewId,
}: {
  filter: ReviewModerationStatus | "reported";
  reviews: Review[];
  openReports: ReviewReport[];
  sessionsByReviewId: Record<string, ReviewVerificationSession>;
}) {
  const [pendingTx, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function run(
    action: () => Promise<{ ok: boolean; message?: string }>,
    successFallback: string,
  ) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.message ?? "Ошибка");
      else setMessage(result.message ?? successFallback);
    });
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.id}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              filter === f.id
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
            href={`/admin/reviews?filter=${f.id}`}
            style={filter === f.id ? { color: "#ffffff" } : undefined}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {error && <AuthAlert>{error}</AuthAlert>}
      {message && <AuthAlert tone="success">{message}</AuthAlert>}

      {filter !== "reported" && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">
            {MODERATION_STATUS_LABELS[filter as ReviewModerationStatus] ?? filter} (
            {reviews.length})
          </h2>
          {reviews.length === 0 ? (
            <p className="text-sm text-slate-500">Нет отзывов в этой категории.</p>
          ) : (
            <ul className="space-y-4">
              {reviews.map((review) => {
                const session = sessionsByReviewId[review.id];
                return (
                  <li
                    key={review.id}
                    className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm text-slate-500">
                          {review.authorDisplayName || "Пользователь"} ·{" "}
                          {review.rating}/5 · {review.verificationLevel}
                        </p>
                        <p className="mt-1 text-sm text-slate-800">{review.body}</p>
                      </div>
                      <span className="text-xs text-slate-400">
                        {review.moderationStatus}
                      </span>
                    </div>

                    {review.verificationSummary && (
                      <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                        <p className="text-xs font-semibold uppercase tracking-wide">
                          Verification summary (internal)
                        </p>
                        <p className="mt-1">{review.verificationSummary}</p>
                        {typeof review.verificationScore === "number" && (
                          <p className="mt-1 text-xs">
                            Score: {review.verificationScore}
                          </p>
                        )}
                      </div>
                    )}

                    {session?.messages && session.messages.length > 0 && (
                      <div className="space-y-1 rounded-lg border border-slate-100 bg-slate-50 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          AI transcript
                        </p>
                        {session.messages.map((m) => (
                          <p key={m.id} className="text-sm text-slate-700">
                            <span className="font-medium text-slate-500">
                              {m.role}:
                            </span>{" "}
                            {m.body}
                          </p>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <Button
                        className="gap-2 disabled:opacity-60"
                        disabled={pendingTx}
                        onClick={() =>
                          run(
                            () =>
                              adminSetReviewModerationAction({
                                reviewId: review.id,
                                moderationStatus: "published",
                                verificationLevel: "ai_verified",
                              }),
                            "Published as AI-verified",
                          )
                        }
                        type="button"
                      >
                        {pendingTx && <Loader2 className="size-4 animate-spin" />}
                        Publish as AI-verified
                      </Button>
                      <Button
                        className="disabled:opacity-60"
                        disabled={pendingTx}
                        onClick={() =>
                          run(
                            () =>
                              adminSetReviewModerationAction({
                                reviewId: review.id,
                                moderationStatus: "published",
                                verificationLevel: "unverified",
                              }),
                            "Published as unverified",
                          )
                        }
                        type="button"
                        variant="secondary"
                      >
                        Publish as unverified
                      </Button>
                      <Button
                        className="disabled:opacity-60"
                        disabled={pendingTx}
                        onClick={() =>
                          run(
                            () =>
                              adminSetReviewModerationAction({
                                reviewId: review.id,
                                moderationStatus: "rejected",
                              }),
                            "Rejected",
                          )
                        }
                        type="button"
                        variant="secondary"
                      >
                        Reject
                      </Button>
                      <Button
                        className="disabled:opacity-60"
                        disabled={pendingTx}
                        onClick={() =>
                          run(
                            () =>
                              adminSetReviewModerationAction({
                                reviewId: review.id,
                                moderationStatus: "hidden",
                              }),
                            "Hidden",
                          )
                        }
                        type="button"
                        variant="secondary"
                      >
                        Hide
                      </Button>
                      <Button
                        className="disabled:opacity-60"
                        disabled={pendingTx}
                        onClick={() =>
                          run(
                            () =>
                              adminSetReviewModerationAction({
                                reviewId: review.id,
                                moderationStatus: "manual_review",
                              }),
                            "Sent to manual review",
                          )
                        }
                        type="button"
                        variant="secondary"
                      >
                        Manual review
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {(filter === "reported" || filter === "manual_review") && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">
            Open reports ({openReports.length})
          </h2>
          {openReports.length === 0 ? (
            <p className="text-sm text-slate-500">Нет открытых жалоб.</p>
          ) : (
            <ul className="space-y-3">
              {openReports.map((report) => (
                <li
                  key={report.id}
                  className="space-y-2 rounded-xl border border-slate-200 bg-white p-4"
                >
                  <p className="text-sm font-medium text-slate-900">
                    {REVIEW_REPORT_REASON_LABELS[report.reason]}
                  </p>
                  {report.details && (
                    <p className="text-sm text-slate-600">{report.details}</p>
                  )}
                  {report.review && (
                    <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                      <p className="text-xs text-slate-400">
                        Отзыв · {report.review.rating}/5 ·{" "}
                        {report.review.moderationStatus}
                      </p>
                      <p className="mt-1">{report.review.body}</p>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="disabled:opacity-60"
                      disabled={pendingTx}
                      onClick={() =>
                        run(
                          () =>
                            adminSetReportStatusAction({
                              reportId: report.id,
                              status: "reviewed",
                              hideReview: true,
                              reviewId: report.reviewId,
                            }),
                          "Review hidden",
                        )
                      }
                      type="button"
                    >
                      Hide review
                    </Button>
                    <Button
                      className="disabled:opacity-60"
                      disabled={pendingTx}
                      onClick={() =>
                        run(
                          () =>
                            adminSetReportStatusAction({
                              reportId: report.id,
                              status: "dismissed",
                            }),
                          "Dismissed",
                        )
                      }
                      type="button"
                      variant="secondary"
                    >
                      Dismiss
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
