"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { verificationEngine } from "@/lib/reviews/verification-engine";
import {
  MAX_REPLY_BODY,
  MAX_REVIEW_BODY,
  MIN_REVIEW_BODY,
  type ReviewModerationStatus,
  type ReviewReportReason,
  type ReviewVerificationLevel,
} from "@/types/review";

export type ReviewActionResult =
  | { ok: true; message?: string; reviewId?: string; sessionId?: string; outcome?: string }
  | { ok: false; message: string };

function fail(message: string): ReviewActionResult {
  return { ok: false, message };
}

function ok(
  message?: string,
  extra?: Partial<Extract<ReviewActionResult, { ok: true }>>,
): ReviewActionResult {
  return { ok: true, message, ...extra };
}

function mapDbError(error: { message?: string; code?: string } | null): string {
  const message = (error?.message ?? "").toLowerCase();
  if (message.includes("rate limit")) {
    return "Слишком много действий. Подождите и попробуйте снова.";
  }
  if (message.includes("24 hours")) {
    return "Оставлять отзывы можно через 24 часа после регистрации.";
  }
  if (message.includes("own business")) {
    return "Владелец не может оставлять отзыв на свой бизнес.";
  }
  if (message.includes("duplicate") || error?.code === "23505") {
    return "Вы уже оставляли отзыв на этот бизнес.";
  }
  if (message.includes("reviews_body_length") || message.includes("body_length")) {
    return `Текст отзыва: от ${MIN_REVIEW_BODY} до ${MAX_REVIEW_BODY} символов.`;
  }
  if (message.includes("cannot report your own")) {
    return "Нельзя пожаловаться на собственный отзыв.";
  }
  if (message.includes("only business owner")) {
    return "Отвечать может только владелец бизнеса.";
  }
  if (message.includes("expired")) {
    return "Срок проверки истёк. Создать новый отзыв нельзя — обратитесь в поддержку или дождитесь сброса.";
  }
  if (message.includes("substantive") || message.includes("answer must")) {
    return "Ответ слишком короткий или бессодержательный.";
  }
  if (message.includes("not awaiting verification")) {
    return "Этот отзыв уже не ожидает проверки.";
  }
  return error?.message?.trim() || "Не удалось выполнить действие.";
}

async function requireUser() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, user: null as null, error: fail("Нужно войти в аккаунт.") };
  }
  return { supabase, user, error: null };
}

function validateReviewInput(rating: number, body: string): string | null {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return "Оценка должна быть от 1 до 5.";
  }
  const trimmed = body.trim();
  if (trimmed.length < MIN_REVIEW_BODY || trimmed.length > MAX_REVIEW_BODY) {
    return `Текст отзыва: от ${MIN_REVIEW_BODY} до ${MAX_REVIEW_BODY} символов.`;
  }
  return null;
}

/** Step 1: save draft review and start AI verification session. */
export async function startReviewVerificationAction(input: {
  businessId: string;
  businessSlug: string;
  rating: number;
  body: string;
  existingReviewId?: string | null;
}): Promise<ReviewActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const validation = validateReviewInput(input.rating, input.body);
  if (validation) return fail(validation);

  const body = input.body.trim();

  const { error: rateError } = await supabase.rpc("assert_review_write_rate_limit");
  if (rateError) return fail(mapDbError(rateError));

  let reviewId = input.existingReviewId ?? null;

  if (reviewId) {
    const { data: existing, error: fetchError } = await supabase
      .from("reviews")
      .select("id, moderation_status")
      .eq("id", reviewId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (fetchError) return fail(mapDbError(fetchError));
    if (!existing) return fail("Отзыв не найден.");

    if (
      !["verification_pending", "verification_in_progress", "expired"].includes(
        existing.moderation_status,
      )
    ) {
      // Published / manual — allow body/rating edit only (status locked by trigger)
      const { error: updateError } = await supabase
        .from("reviews")
        .update({ rating: input.rating, body })
        .eq("id", reviewId)
        .eq("user_id", user.id);
      if (updateError) return fail(mapDbError(updateError));
      revalidatePath(`/business/${input.businessSlug}`);
      return ok("Отзыв обновлён.");
    }

    const { error: updateError } = await supabase
      .from("reviews")
      .update({ rating: input.rating, body })
      .eq("id", reviewId)
      .eq("user_id", user.id);
    if (updateError) return fail(mapDbError(updateError));
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from("reviews")
      .insert({
        business_id: input.businessId,
        rating: input.rating,
        body,
      })
      .select("id")
      .single();

    if (insertError) return fail(mapDbError(insertError));
    reviewId = inserted.id;
  }

  try {
    const session = await verificationEngine.createVerificationSession(
      supabase,
      reviewId,
    );
    revalidatePath(`/business/${input.businessSlug}`);
    revalidatePath("/profile");
    return ok("Переходим к проверке.", {
      reviewId,
      sessionId: session.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Не удалось начать проверку.";
    return fail(mapDbError({ message }));
  }
}

export async function submitVerificationAnswerAction(input: {
  sessionId: string;
  answer: string;
  businessSlug: string;
}): Promise<ReviewActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  try {
    const result = await verificationEngine.submitVerificationAnswer(
      supabase,
      input.sessionId,
      input.answer,
    );
    revalidatePath(`/business/${input.businessSlug}`);
    revalidatePath("/profile");
    revalidatePath("/admin/reviews");

    if (result.complete) {
      if (result.outcome === "manual_review") {
        return ok("Отзыв отправлен на дополнительную проверку.", {
          outcome: "manual_review",
        });
      }
      return ok("Отзыв подтверждён и опубликован.", { outcome: "published" });
    }

    return ok("Ответ сохранён.", {
      outcome: "in_progress",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Не удалось отправить ответ.";
    return fail(mapDbError({ message }));
  }
}

export async function hideOwnReviewAction(input: {
  reviewId: string;
  businessSlug: string;
}): Promise<ReviewActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const { error: rpcError } = await supabase.rpc("hide_own_review", {
    p_review_id: input.reviewId,
  });
  if (rpcError) return fail(mapDbError(rpcError));

  revalidatePath(`/business/${input.businessSlug}`);
  revalidatePath("/profile");
  return ok("Отзыв скрыт.");
}

export async function reportReviewAction(input: {
  reviewId: string;
  businessSlug: string;
  reason: ReviewReportReason;
  details?: string;
}): Promise<ReviewActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const allowed: ReviewReportReason[] = [
    "spam",
    "offensive",
    "fake",
    "off_topic",
    "other",
  ];
  if (!allowed.includes(input.reason)) {
    return fail("Выберите причину жалобы.");
  }

  const details = input.details?.trim() || null;
  if (details && details.length > 1000) {
    return fail("Комментарий к жалобе слишком длинный.");
  }

  const { error: rateError } = await supabase.rpc("assert_review_report_rate_limit");
  if (rateError) return fail(mapDbError(rateError));

  const { error: insertError } = await supabase.from("review_reports").insert({
    review_id: input.reviewId,
    reason: input.reason,
    details,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return fail("Вы уже жаловались на этот отзыв.");
    }
    return fail(mapDbError(insertError));
  }

  revalidatePath(`/business/${input.businessSlug}`);
  revalidatePath("/admin/reviews");
  return ok("Жалоба отправлена.");
}

export async function upsertOwnerReplyAction(input: {
  reviewId: string;
  businessSlug: string;
  body: string;
  existingReplyId?: string | null;
}): Promise<ReviewActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const body = input.body.trim();
  if (!body || body.length > MAX_REPLY_BODY) {
    return fail(`Ответ: от 1 до ${MAX_REPLY_BODY} символов.`);
  }

  if (input.existingReplyId) {
    const { error: updateError } = await supabase
      .from("review_replies")
      .update({ body })
      .eq("id", input.existingReplyId)
      .eq("author_user_id", user.id);

    if (updateError) return fail(mapDbError(updateError));
  } else {
    const { error: insertError } = await supabase.from("review_replies").insert({
      review_id: input.reviewId,
      body,
    });
    if (insertError) return fail(mapDbError(insertError));
  }

  revalidatePath(`/business/${input.businessSlug}`);
  return ok("Ответ сохранён.");
}

export async function adminSetReviewModerationAction(input: {
  reviewId: string;
  moderationStatus: ReviewModerationStatus;
  verificationLevel?: ReviewVerificationLevel | null;
}): Promise<ReviewActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError) return fail(mapDbError(adminError));
  if (!isAdmin) return fail("Доступ только для администратора.");

  const { error: rpcError } = await supabase.rpc("admin_set_review_moderation", {
    p_review_id: input.reviewId,
    p_moderation_status: input.moderationStatus,
    p_verification_level: input.verificationLevel ?? null,
  });
  if (rpcError) return fail(mapDbError(rpcError));

  revalidatePath("/admin/reviews");
  return ok("Статус отзыва обновлён.");
}

export async function adminSetReportStatusAction(input: {
  reportId: string;
  status: "reviewed" | "dismissed";
  hideReview?: boolean;
  reviewId?: string;
}): Promise<ReviewActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError) return fail(mapDbError(adminError));
  if (!isAdmin) return fail("Доступ только для администратора.");

  if (input.hideReview && input.reviewId) {
    const { error: hideError } = await supabase.rpc("admin_set_review_moderation", {
      p_review_id: input.reviewId,
      p_moderation_status: "hidden",
      p_verification_level: null,
    });
    if (hideError) return fail(mapDbError(hideError));
  }

  const { error: rpcError } = await supabase.rpc("admin_set_report_status", {
    p_report_id: input.reportId,
    p_status: input.status,
  });
  if (rpcError) return fail(mapDbError(rpcError));

  revalidatePath("/admin/reviews");
  return ok("Жалоба обработана.");
}
