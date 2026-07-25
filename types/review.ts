export type ReviewModerationStatus =
  | "verification_pending"
  | "verification_in_progress"
  | "manual_review"
  | "published"
  | "rejected"
  | "hidden"
  | "expired";

export type ReviewVerificationLevel =
  | "unverified"
  | "ai_verified"
  | "transaction_verified";

export type ReviewVerificationSessionStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "manual_review"
  | "expired";

export type ReviewVerificationMessageRole = "agent" | "user" | "system";

export type ReviewReportStatus = "open" | "reviewed" | "dismissed";
export type ReviewReportReason =
  | "spam"
  | "offensive"
  | "fake"
  | "off_topic"
  | "other";

export type ReviewAuthor = {
  id: string;
  displayName: string | null;
};

export type ReviewReply = {
  id: string;
  reviewId: string;
  businessId: string;
  authorUserId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type Review = {
  id: string;
  businessId: string;
  userId: string;
  rating: number;
  body: string;
  moderationStatus: ReviewModerationStatus;
  verificationLevel: ReviewVerificationLevel;
  verificationCompletedAt: string | null;
  publishedAt: string | null;
  expiresAt: string | null;
  authorDisplayName: string | null;
  createdAt: string;
  updatedAt: string;
  author: ReviewAuthor | null;
  reply: ReviewReply | null;
  /** Admin-only fields; omitted for public listings */
  verificationScore?: number | null;
  verificationSummary?: string | null;
};

export type ReviewVerificationMessage = {
  id: string;
  sessionId: string;
  role: ReviewVerificationMessageRole;
  body: string;
  questionType: string | null;
  sequenceNumber: number;
  createdAt: string;
};

export type ReviewVerificationSession = {
  id: string;
  reviewId: string;
  userId: string;
  status: ReviewVerificationSessionStatus;
  currentQuestionIndex: number;
  questionsRequired: number;
  startedAt: string;
  completedAt: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  messages?: ReviewVerificationMessage[];
  /** Admin-only */
  score?: number | null;
  resultSummary?: string | null;
};

export type IncompleteVerificationItem = {
  reviewId: string;
  businessId: string;
  businessSlug: string;
  businessName: string;
  sessionId: string;
  expiresAt: string;
  currentQuestionIndex: number;
  questionsRequired: number;
  rating: number;
};

export type ReviewReport = {
  id: string;
  reviewId: string;
  reporterUserId: string;
  reason: ReviewReportReason;
  details: string | null;
  status: ReviewReportStatus;
  createdAt: string;
  review?: Pick<
    Review,
    "id" | "body" | "rating" | "businessId" | "userId" | "moderationStatus"
  > | null;
};

export const REVIEW_REPORT_REASON_LABELS: Record<ReviewReportReason, string> = {
  spam: "Спам",
  offensive: "Оскорбления",
  fake: "Фейковый отзыв",
  off_topic: "Не по теме",
  other: "Другое",
};

export const VERIFICATION_LEVEL_LABELS: Record<ReviewVerificationLevel, string> =
  {
    unverified: "Без подтверждения",
    ai_verified: "Подтверждён через AI-интервью",
    transaction_verified: "Подтверждённый клиент",
  };

export const MODERATION_STATUS_LABELS: Record<ReviewModerationStatus, string> =
  {
    verification_pending: "Ожидает проверки",
    verification_in_progress: "Проверка в процессе",
    manual_review: "Ручная проверка",
    published: "Опубликован",
    rejected: "Отклонён",
    hidden: "Скрыт",
    expired: "Истёк срок проверки",
  };

export const MIN_REVIEW_BODY = 20;
export const MAX_REVIEW_BODY = 3000;
export const MAX_REPLY_BODY = 2000;
export const MIN_ANSWER_BODY = 5;
export const MAX_ANSWER_BODY = 1500;

/** @deprecated use ReviewModerationStatus */
export type ReviewStatus = ReviewModerationStatus;
