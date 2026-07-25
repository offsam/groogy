"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { BadgeCheck, Flag, Loader2, Sparkles, Star } from "lucide-react";
import {
  hideOwnReviewAction,
  reportReviewAction,
  startReviewVerificationAction,
  submitVerificationAnswerAction,
  upsertOwnerReplyAction,
} from "@/lib/reviews/actions";
import { AuthAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import {
  MAX_ANSWER_BODY,
  MAX_REPLY_BODY,
  MAX_REVIEW_BODY,
  MIN_ANSWER_BODY,
  MIN_REVIEW_BODY,
  REVIEW_REPORT_REASON_LABELS,
  VERIFICATION_LEVEL_LABELS,
  type Review,
  type ReviewReportReason,
  type ReviewVerificationSession,
} from "@/types/review";

function Stars({
  value,
  onChange,
  readOnly = false,
}: {
  value: number;
  onChange?: (n: number) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          aria-label={`${n} из 5`}
          className={readOnly ? "cursor-default" : "cursor-pointer"}
          disabled={readOnly}
          onClick={() => onChange?.(n)}
          type="button"
        >
          <Star
            aria-hidden="true"
            className={`size-5 ${
              n <= value
                ? "fill-amber-500 text-amber-500"
                : "fill-transparent text-slate-300"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function formatRemaining(expiresAt: string) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "срок истёк";
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days >= 1) return `осталось ~${days} д.`;
  if (hours >= 1) return `осталось ~${hours} ч.`;
  const mins = Math.max(1, Math.floor(ms / (1000 * 60)));
  return `осталось ~${mins} мин.`;
}

function VerificationBadge({ level }: { level: Review["verificationLevel"] }) {
  if (level === "transaction_verified") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
        <BadgeCheck aria-hidden="true" className="size-3.5" />
        {VERIFICATION_LEVEL_LABELS.transaction_verified}
      </span>
    );
  }
  if (level === "ai_verified") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">
        <Sparkles aria-hidden="true" className="size-3.5" />
        {VERIFICATION_LEVEL_LABELS.ai_verified}
      </span>
    );
  }
  return null;
}

function ReviewCard({
  review,
  isOwner,
  currentUserId,
  businessSlug,
}: {
  review: Review;
  isOwner: boolean;
  currentUserId: string | null;
  businessSlug: string;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [reason, setReason] = useState<ReviewReportReason>("spam");
  const [details, setDetails] = useState("");
  const [replyBody, setReplyBody] = useState(review.reply?.body ?? "");
  const [showReply, setShowReply] = useState(Boolean(review.reply));

  const isMine = currentUserId === review.userId;

  return (
    <article className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-900">
              {review.authorDisplayName || "Пользователь"}
            </p>
            <VerificationBadge level={review.verificationLevel} />
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {formatDate(review.publishedAt || review.createdAt)}
          </p>
        </div>
        <Stars readOnly value={review.rating} />
      </div>

      <p className="whitespace-pre-wrap text-sm text-slate-700">{review.body}</p>

      {review.reply && (
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Ответ бизнеса
          </p>
          <p className="mt-1 whitespace-pre-wrap text-slate-700">{review.reply.body}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {currentUserId && !isMine && (
          <Button
            className="gap-1.5 px-3 text-xs"
            onClick={() => setShowReport((v) => !v)}
            type="button"
            variant="secondary"
          >
            <Flag aria-hidden="true" className="size-3.5" />
            Пожаловаться
          </Button>
        )}
        {isOwner && (
          <Button
            className="px-3 text-xs"
            onClick={() => setShowReply((v) => !v)}
            type="button"
            variant="secondary"
          >
            {review.reply ? "Редактировать ответ" : "Ответить"}
          </Button>
        )}
        {isMine && review.moderationStatus === "published" && (
          <Button
            className="px-3 text-xs disabled:opacity-60"
            disabled={pending}
            onClick={() => {
              setError(null);
              setMessage(null);
              startTransition(async () => {
                const result = await hideOwnReviewAction({
                  reviewId: review.id,
                  businessSlug,
                });
                if (!result.ok) setError(result.message);
                else setMessage(result.message ?? "Скрыто");
              });
            }}
            type="button"
            variant="secondary"
          >
            Скрыть отзыв
          </Button>
        )}
      </div>

      {showReport && (
        <form
          className="space-y-2 rounded-lg border border-slate-100 bg-slate-50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setMessage(null);
            startTransition(async () => {
              const result = await reportReviewAction({
                reviewId: review.id,
                businessSlug,
                reason,
                details,
              });
              if (!result.ok) setError(result.message);
              else {
                setMessage(result.message ?? "Отправлено");
                setShowReport(false);
              }
            });
          }}
        >
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Причина</span>
            <select
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
              onChange={(e) => setReason(e.target.value as ReviewReportReason)}
              value={reason}
            >
              {(Object.keys(REVIEW_REPORT_REASON_LABELS) as ReviewReportReason[]).map(
                (key) => (
                  <option key={key} value={key}>
                    {REVIEW_REPORT_REASON_LABELS[key]}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Комментарий (необязательно)</span>
            <textarea
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
              maxLength={1000}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
              value={details}
            />
          </label>
          <Button className="gap-2 disabled:opacity-60" disabled={pending} type="submit">
            {pending && <Loader2 className="size-4 animate-spin" />}
            Отправить жалобу
          </Button>
        </form>
      )}

      {showReply && isOwner && (
        <form
          className="space-y-2 rounded-lg border border-slate-100 bg-slate-50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setMessage(null);
            startTransition(async () => {
              const result = await upsertOwnerReplyAction({
                reviewId: review.id,
                businessSlug,
                body: replyBody,
                existingReplyId: review.reply?.id,
              });
              if (!result.ok) setError(result.message);
              else setMessage(result.message ?? "Сохранено");
            });
          }}
        >
          <textarea
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            maxLength={MAX_REPLY_BODY}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Официальный ответ бизнеса"
            required
            rows={3}
            value={replyBody}
          />
          <Button className="gap-2 disabled:opacity-60" disabled={pending} type="submit">
            {pending && <Loader2 className="size-4 animate-spin" />}
            Сохранить ответ
          </Button>
        </form>
      )}

      {error && <AuthAlert>{error}</AuthAlert>}
      {message && <AuthAlert tone="success">{message}</AuthAlert>}
    </article>
  );
}

function VerificationChat({
  session,
  businessSlug,
  onFinished,
}: {
  session: ReviewVerificationSession;
  businessSlug: string;
  onFinished: (outcome: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [localMessages, setLocalMessages] = useState(session.messages ?? []);
  const [answeredCount, setAnsweredCount] = useState(session.currentQuestionIndex);

  const visibleMessages = useMemo(() => {
    const agentSeen = { count: 0 };
    return localMessages.filter((m) => {
      if (m.role === "user" || m.role === "system") return true;
      if (m.role === "agent") {
        const show = agentSeen.count <= answeredCount;
        agentSeen.count += 1;
        return show;
      }
      return true;
    });
  }, [localMessages, answeredCount]);

  const agentQuestions = useMemo(
    () => localMessages.filter((m) => m.role === "agent"),
    [localMessages],
  );
  const nextQuestion = agentQuestions[answeredCount] ?? null;
  const expired = new Date(session.expiresAt).getTime() <= Date.now();

  return (
    <div className="space-y-4 rounded-xl border border-sky-200 bg-sky-50/40 p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-900">AI-проверка отзыва</h3>
          <p className="mt-1 text-sm text-slate-600">
            Проверка обычно занимает меньше минуты. Без неё отзыв не публикуется.
          </p>
        </div>
        <p className="text-sm font-medium text-sky-800">
          Вопрос {Math.min(answeredCount + 1, session.questionsRequired)} из{" "}
          {session.questionsRequired}
        </p>
      </div>

      <p className="text-xs text-slate-500">{formatRemaining(session.expiresAt)}</p>

      <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3">
        {visibleMessages.map((m) => (
          <div
            key={m.id}
            className={`rounded-lg px-3 py-2 text-sm ${
              m.role === "user"
                ? "ml-8 bg-slate-900 text-white"
                : m.role === "system"
                  ? "bg-slate-100 text-slate-600"
                  : "mr-8 bg-sky-100 text-slate-800"
            }`}
          >
            {m.body}
          </div>
        ))}
      </div>

      {expired ? (
        <AuthAlert>Срок проверки истёк. Отзыв не будет опубликован.</AuthAlert>
      ) : nextQuestion ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await submitVerificationAnswerAction({
                sessionId: session.id,
                answer,
                businessSlug,
              });
              if (!result.ok) {
                setError(result.message);
                return;
              }
              setLocalMessages((prev) => [
                ...prev,
                {
                  id: `local-${Date.now()}`,
                  sessionId: session.id,
                  role: "user",
                  body: answer.trim(),
                  questionType: "answer",
                  sequenceNumber: prev.length + 1,
                  createdAt: new Date().toISOString(),
                },
              ]);
              setAnswer("");
              const nextAnswered = answeredCount + 1;
              setAnsweredCount(nextAnswered);
              if (result.outcome === "published" || result.outcome === "manual_review") {
                onFinished(result.outcome);
              }
            });
          }}
        >
          <textarea
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            maxLength={MAX_ANSWER_BODY}
            minLength={MIN_ANSWER_BODY}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Ваш ответ"
            required
            rows={3}
            value={answer}
          />
          {error && <AuthAlert>{error}</AuthAlert>}
          <Button className="gap-2 disabled:opacity-60" disabled={pending} type="submit">
            {pending && <Loader2 className="size-4 animate-spin" />}
            Отправить ответ
          </Button>
        </form>
      ) : (
        <p className="text-sm text-slate-600">Обрабатываем ответы…</p>
      )}
    </div>
  );
}

function ReviewComposer({
  businessId,
  businessSlug,
  existing,
  initialSession,
}: {
  businessId: string;
  businessSlug: string;
  existing: Review | null;
  initialSession: ReviewVerificationSession | null;
}) {
  const needsVerification =
    existing &&
    ["verification_pending", "verification_in_progress"].includes(
      existing.moderationStatus,
    );

  const [step, setStep] = useState<"form" | "chat" | "done">(
    needsVerification && initialSession ? "chat" : "form",
  );
  const [session, setSession] = useState<ReviewVerificationSession | null>(
    initialSession,
  );
  const [rating, setRating] = useState(existing?.rating ?? 5);
  const [body, setBody] = useState(existing?.body ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  if (existing?.moderationStatus === "published") {
    return (
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="font-semibold text-slate-900">Ваш отзыв опубликован</h3>
        <Stars readOnly value={existing.rating} />
        <p className="whitespace-pre-wrap text-sm text-slate-700">{existing.body}</p>
        <VerificationBadge level={existing.verificationLevel} />
      </div>
    );
  }

  if (existing?.moderationStatus === "manual_review") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
        Ваш отзыв на дополнительной проверке. Мы сообщим о результате в профиле.
      </div>
    );
  }

  if (existing?.moderationStatus === "rejected") {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-800">
        Отзыв отклонён модератором.
      </div>
    );
  }

  if (existing?.moderationStatus === "hidden") {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
        Ваш отзыв скрыт.
      </div>
    );
  }

  if (existing?.moderationStatus === "expired") {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
        Срок AI-проверки истёк. Отзыв не опубликован.
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-6 text-center">
        <p className="font-semibold text-emerald-900">
          {doneMessage ?? "Готово"}
        </p>
      </div>
    );
  }

  if (step === "chat" && session) {
    return (
      <VerificationChat
        businessSlug={businessSlug}
        onFinished={(outcome) => {
          setDoneMessage(
            outcome === "manual_review"
              ? "Отзыв отправлен на дополнительную проверку"
              : "Отзыв подтверждён и опубликован",
          );
          setStep("done");
        }}
        session={session}
      />
    );
  }

  return (
    <form
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await startReviewVerificationAction({
            businessId,
            businessSlug,
            rating,
            body,
            existingReviewId: existing?.id,
          });
          if (!result.ok) {
            setError(result.message);
            return;
          }
          if (result.sessionId) {
            setSession({
              id: result.sessionId,
              reviewId: result.reviewId ?? existing?.id ?? "",
              userId: "",
              status: "in_progress",
              currentQuestionIndex: 0,
              questionsRequired: 3,
              startedAt: new Date().toISOString(),
              completedAt: null,
              expiresAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              messages: [
                {
                  id: "intro",
                  sessionId: result.sessionId,
                  role: "system",
                  body: "Проверка обычно занимает меньше минуты. Ответьте на 3 коротких вопроса.",
                  questionType: "intro",
                  sequenceNumber: 1,
                  createdAt: new Date().toISOString(),
                },
                {
                  id: "q1",
                  sessionId: result.sessionId,
                  role: "agent",
                  body: "Что именно вы покупали или какую услугу получили?",
                  questionType: "purchase_or_service",
                  sequenceNumber: 2,
                  createdAt: new Date().toISOString(),
                },
                {
                  id: "q2",
                  sessionId: result.sessionId,
                  role: "agent",
                  body: "Примерно когда это произошло?",
                  questionType: "timeframe",
                  sequenceNumber: 3,
                  createdAt: new Date().toISOString(),
                },
                {
                  id: "q3",
                  sessionId: result.sessionId,
                  role: "agent",
                  body: `Вы написали: «${body.trim().slice(0, 80)}${body.trim().length > 80 ? "…" : ""}». Уточните, что повлияло на вашу оценку больше всего?`,
                  questionType: "clarifying",
                  sequenceNumber: 4,
                  createdAt: new Date().toISOString(),
                },
              ],
            });
            setStep("chat");
          }
        });
      }}
    >
      <h3 className="font-semibold text-slate-900">
        {existing ? "Продолжить отзыв" : "Оставить отзыв"}
      </h3>
      <p className="text-sm text-slate-500">
        Шаг 1 из 2 — оценка и текст. Затем короткий AI-диалог.
      </p>
      <Stars onChange={setRating} value={rating} />
      <textarea
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        maxLength={MAX_REVIEW_BODY}
        minLength={MIN_REVIEW_BODY}
        onChange={(e) => setBody(e.target.value)}
        placeholder={`Минимум ${MIN_REVIEW_BODY} символов`}
        required
        rows={4}
        value={body}
      />
      <p className="text-xs text-slate-400">
        {body.trim().length}/{MAX_REVIEW_BODY}
      </p>
      {error && <AuthAlert>{error}</AuthAlert>}
      <Button className="gap-2 disabled:opacity-60" disabled={pending} type="submit">
        {pending && <Loader2 className="size-4 animate-spin" />}
        Продолжить проверку
      </Button>
    </form>
  );
}

export function BusinessReviewsSection({
  businessId,
  businessSlug,
  ratingAvg,
  reviewsCount,
  aiVerifiedCount,
  transactionVerifiedCount,
  reviews,
  myReview,
  mySession,
  isOwner,
  currentUserId,
}: {
  businessId: string;
  businessSlug: string;
  ratingAvg: number;
  reviewsCount: number;
  aiVerifiedCount: number;
  transactionVerifiedCount: number;
  reviews: Review[];
  myReview: Review | null;
  mySession: ReviewVerificationSession | null;
  isOwner: boolean;
  currentUserId: string | null;
}) {
  const canWrite = Boolean(currentUserId) && !isOwner;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Отзывы</h2>
          <p className="mt-1 text-sm text-slate-500">
            {reviewsCount > 0
              ? `${ratingAvg.toFixed(1)} · ${reviewsCount} опубликованных`
              : "Пока нет опубликованных отзывов"}
          </p>
          {reviewsCount > 0 && (
            <p className="mt-1 text-xs text-slate-400">
              AI-подтверждённых: {aiVerifiedCount} · Подтверждённых клиентов:{" "}
              {transactionVerifiedCount}
            </p>
          )}
        </div>
      </div>

      {!currentUserId && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center">
          <p className="text-sm text-slate-600">Чтобы оставить отзыв, войдите в аккаунт.</p>
          <Link
            className="mt-3 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            href={`/login?next=${encodeURIComponent(`/business/${businessSlug}`)}`}
            style={{ color: "#ffffff" }}
          >
            Войти
          </Link>
        </div>
      )}

      {isOwner && (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Вы владелец этого бизнеса — оставлять отзыв нельзя, но можно отвечать на
          опубликованные отзывы. Диалог AI-проверки пользователей вам недоступен.
        </p>
      )}

      {canWrite && (
        <ReviewComposer
          businessId={businessId}
          businessSlug={businessSlug}
          existing={myReview}
          initialSession={mySession}
        />
      )}

      {reviews.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
          Пока нет опубликованных отзывов. Будьте первым — после короткой AI-проверки.
        </div>
      ) : (
        <ul className="space-y-3">
          {reviews.map((review) => (
            <li key={review.id}>
              <ReviewCard
                businessSlug={businessSlug}
                currentUserId={currentUserId}
                isOwner={isOwner}
                review={review}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
