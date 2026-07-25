import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ProfileRow } from "@/types/database";
import type {
  IncompleteVerificationItem,
  Review,
  ReviewModerationStatus,
  ReviewReply,
  ReviewReport,
  ReviewReportReason,
  ReviewVerificationMessage,
  ReviewVerificationSession,
} from "@/types/review";

type Client = SupabaseClient<Database>;

type ReviewRow = Database["public"]["Tables"]["reviews"]["Row"];
type ReplyRow = Database["public"]["Tables"]["review_replies"]["Row"];
type ReportRow = Database["public"]["Tables"]["review_reports"]["Row"];
type SessionRow =
  Database["public"]["Tables"]["review_verification_sessions"]["Row"];
type MessageRow =
  Database["public"]["Tables"]["review_verification_messages"]["Row"];

type ReviewQueryRow = ReviewRow & {
  profiles: Pick<ProfileRow, "id" | "display_name"> | null;
  review_replies: ReplyRow[] | ReplyRow | null;
};

function mapReply(row: ReplyRow): ReviewReply {
  return {
    id: row.id,
    reviewId: row.review_id,
    businessId: row.business_id,
    authorUserId: row.author_user_id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReview(row: ReviewQueryRow, includeInternal = false): Review {
  const replyRaw = row.review_replies;
  const reply = Array.isArray(replyRaw) ? (replyRaw[0] ?? null) : replyRaw;
  const displayName =
    row.author_display_name ?? row.profiles?.display_name ?? null;

  const base: Review = {
    id: row.id,
    businessId: row.business_id,
    userId: row.user_id,
    rating: row.rating,
    body: row.body,
    moderationStatus: row.moderation_status,
    verificationLevel: row.verification_level,
    verificationCompletedAt: row.verification_completed_at,
    publishedAt: row.published_at,
    expiresAt: row.expires_at,
    authorDisplayName: displayName,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: row.profiles
      ? { id: row.profiles.id, displayName: row.profiles.display_name }
      : displayName
        ? { id: row.user_id, displayName }
        : null,
    reply: reply ? mapReply(reply) : null,
  };

  if (includeInternal) {
    base.verificationScore = row.verification_score;
    base.verificationSummary = row.verification_summary;
  }

  return base;
}

function mapMessage(row: MessageRow): ReviewVerificationMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    body: row.body,
    questionType: row.question_type,
    sequenceNumber: row.sequence_number,
    createdAt: row.created_at,
  };
}

function mapSession(
  row: SessionRow,
  messages?: ReviewVerificationMessage[],
  includeInternal = false,
): ReviewVerificationSession {
  const session: ReviewVerificationSession = {
    id: row.id,
    reviewId: row.review_id,
    userId: row.user_id,
    status: row.status,
    currentQuestionIndex: row.current_question_index,
    questionsRequired: row.questions_required,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages,
  };
  if (includeInternal) {
    session.score = row.score;
    session.resultSummary = row.result_summary;
  }
  return session;
}

const REVIEW_SELECT = `
  id,
  business_id,
  user_id,
  rating,
  body,
  moderation_status,
  verification_level,
  verification_score,
  verification_summary,
  verification_completed_at,
  transaction_verified_at,
  published_at,
  expires_at,
  author_display_name,
  created_at,
  updated_at,
  profiles (
    id,
    display_name
  ),
  review_replies (
    id,
    review_id,
    business_id,
    author_user_id,
    body,
    created_at,
    updated_at
  )
` as const;

export async function getPublishedReviewsForBusiness(
  client: Client,
  businessId: string,
): Promise<Review[]> {
  const { data, error } = await client
    .from("reviews")
    .select(REVIEW_SELECT)
    .eq("business_id", businessId)
    .eq("moderation_status", "published")
    .order("published_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return ((data ?? []) as ReviewQueryRow[]).map((row) => mapReview(row, false));
}

export async function getMyReviewForBusiness(
  client: Client,
  businessId: string,
  userId: string,
): Promise<Review | null> {
  const { data, error } = await client
    .from("reviews")
    .select(REVIEW_SELECT)
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapReview(data as ReviewQueryRow, false) : null;
}

export async function getVerificationSessionForReview(
  client: Client,
  reviewId: string,
): Promise<ReviewVerificationSession | null> {
  const { data, error } = await client
    .from("review_verification_sessions")
    .select("*")
    .eq("review_id", reviewId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { data: messages, error: msgError } = await client
    .from("review_verification_messages")
    .select("*")
    .eq("session_id", data.id)
    .order("sequence_number", { ascending: true });
  if (msgError) throw msgError;

  return mapSession(data, (messages ?? []).map(mapMessage), false);
}

export async function userOwnsBusiness(
  client: Client,
  businessId: string,
): Promise<boolean> {
  const { data, error } = await client.rpc("owns_business", {
    p_business_id: businessId,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function userIsAdmin(client: Client): Promise<boolean> {
  const { data, error } = await client.rpc("is_admin");
  if (error) throw error;
  return Boolean(data);
}

export async function getIncompleteVerificationsForUser(
  client: Client,
  userId: string,
): Promise<IncompleteVerificationItem[]> {
  const { data: sessions, error } = await client
    .from("review_verification_sessions")
    .select(
      "id, review_id, expires_at, current_question_index, questions_required, status",
    )
    .eq("user_id", userId)
    .in("status", ["pending", "in_progress"])
    .order("expires_at", { ascending: true });

  if (error) throw error;
  if (!sessions?.length) return [];

  const reviewIds = sessions.map((s) => s.review_id);
  const { data: reviews, error: revError } = await client
    .from("reviews")
    .select("id, rating, business_id, moderation_status")
    .in("id", reviewIds)
    .in("moderation_status", ["verification_pending", "verification_in_progress"]);

  if (revError) throw revError;
  if (!reviews?.length) return [];

  const businessIds = [...new Set(reviews.map((r) => r.business_id))];
  const { data: businesses, error: bizError } = await client
    .from("businesses")
    .select("id, slug, name")
    .in("id", businessIds);
  if (bizError) throw bizError;

  const reviewById = new Map(reviews.map((r) => [r.id, r]));
  const businessById = new Map((businesses ?? []).map((b) => [b.id, b]));

  const items: IncompleteVerificationItem[] = [];
  for (const session of sessions) {
    const review = reviewById.get(session.review_id);
    if (!review) continue;
    const business = businessById.get(review.business_id);
    if (!business) continue;
    items.push({
      reviewId: session.review_id,
      businessId: review.business_id,
      businessSlug: business.slug,
      businessName: business.name,
      sessionId: session.id,
      expiresAt: session.expires_at,
      currentQuestionIndex: session.current_question_index,
      questionsRequired: session.questions_required,
      rating: review.rating,
    });
  }
  return items;
}

export async function getAdminModerationQueue(
  client: Client,
  filter: ReviewModerationStatus | "reported" | "all" = "manual_review",
): Promise<{
  reviews: Review[];
  openReports: ReviewReport[];
  sessionsByReviewId: Record<string, ReviewVerificationSession>;
}> {
  const reviewsQuery = client.from("reviews").select(REVIEW_SELECT);

  if (filter === "reported") {
    // Load via reports below; still fetch manual_review as empty primary list optional
  } else if (filter !== "all") {
    reviewsQuery.eq("moderation_status", filter);
  }

  const [reviewsRes, reportsRes] = await Promise.all([
    filter === "reported"
      ? Promise.resolve({ data: [] as ReviewQueryRow[], error: null })
      : reviewsQuery.order("created_at", { ascending: false }),
    client
      .from("review_reports")
      .select(
        `
        id,
        review_id,
        reporter_user_id,
        reason,
        details,
        status,
        created_at,
        reviews (
          id,
          body,
          rating,
          business_id,
          user_id,
          moderation_status
        )
      `,
      )
      .eq("status", "open")
      .order("created_at", { ascending: false }),
  ]);

  if (reviewsRes.error) throw reviewsRes.error;
  if (reportsRes.error) throw reportsRes.error;

  const reviews = ((reviewsRes.data ?? []) as ReviewQueryRow[]).map((row) =>
    mapReview(row, true),
  );

  const openReports: ReviewReport[] = (reportsRes.data ?? []).map((row) => {
    const r = row as ReportRow & {
      reviews:
        | Pick<
            ReviewRow,
            | "id"
            | "body"
            | "rating"
            | "business_id"
            | "user_id"
            | "moderation_status"
          >
        | null;
    };
    return {
      id: r.id,
      reviewId: r.review_id,
      reporterUserId: r.reporter_user_id,
      reason: r.reason as ReviewReportReason,
      details: r.details,
      status: r.status,
      createdAt: r.created_at,
      review: r.reviews
        ? {
            id: r.reviews.id,
            body: r.reviews.body,
            rating: r.reviews.rating,
            businessId: r.reviews.business_id,
            userId: r.reviews.user_id,
            moderationStatus: r.reviews.moderation_status,
          }
        : null,
    };
  });

  const reviewIds = [
    ...new Set([
      ...reviews.map((r) => r.id),
      ...openReports.map((r) => r.reviewId),
    ]),
  ];

  const sessionsByReviewId: Record<string, ReviewVerificationSession> = {};
  if (reviewIds.length > 0) {
    const { data: sessions, error: sessError } = await client
      .from("review_verification_sessions")
      .select("*")
      .in("review_id", reviewIds);
    if (sessError) throw sessError;

    const sessionIds = (sessions ?? []).map((s) => s.id);
    const { data: messages, error: msgError } =
      sessionIds.length > 0
        ? await client
            .from("review_verification_messages")
            .select("*")
            .in("session_id", sessionIds)
            .order("sequence_number", { ascending: true })
        : { data: [], error: null };
    if (msgError) throw msgError;

    const msgsBySession = new Map<string, ReviewVerificationMessage[]>();
    for (const m of messages ?? []) {
      const list = msgsBySession.get(m.session_id) ?? [];
      list.push(mapMessage(m));
      msgsBySession.set(m.session_id, list);
    }

    for (const s of sessions ?? []) {
      sessionsByReviewId[s.review_id] = mapSession(
        s,
        msgsBySession.get(s.id) ?? [],
        true,
      );
    }
  }

  return { reviews, openReports, sessionsByReviewId };
}
