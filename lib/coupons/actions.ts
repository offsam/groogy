"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { userIsAdmin } from "@/lib/reviews/queries";
import { isCouponCurator } from "@/lib/coupons/curator";
import { resolveCouponLink } from "@/lib/coupons/extract-link";
import { consumeRateLimit } from "@/lib/security/rate-limit";

export type CouponActionResult =
  | { ok: true; message?: string; id?: string }
  | { ok: false; message: string };

function fail(message: string): CouponActionResult {
  return { ok: false, message };
}
function ok(message?: string, id?: string): CouponActionResult {
  return { ok: true, message, id };
}

async function requireCurator() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, user: null, error: fail("Нужно войти в аккаунт.") };
  }
  const [curator, admin] = await Promise.all([
    isCouponCurator(supabase),
    userIsAdmin(supabase),
  ]);
  if (!curator && !admin) {
    return {
      supabase,
      user,
      error: fail("Только куратор раздела «Купонинг» может это делать."),
    };
  }
  return { supabase, user, error: null as null };
}

async function requireUser() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, user: null, error: fail("Нужно войти в аккаунт.") };
  }
  return { supabase, user, error: null as null };
}

/** Curator publishes directly — goes live immediately, no review queue. */
export async function createCouponAction(input: {
  title: string;
  body: string;
  imageUrl?: string | null;
  linkUrl?: string | null;
  promoCode?: string | null;
  categoryId?: string | null;
}): Promise<CouponActionResult> {
  const { user, error } = await requireCurator();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 3) return fail("Заголовок слишком короткий.");
  if (body.length < 10) return fail("Опишите акцию чуть подробнее.");

  const limited = await consumeRateLimit(`coupon-create:${user.id}`, {
    limit: 30,
    windowMs: 60 * 60 * 1000,
  });
  if (!limited.ok) return fail("Слишком много публикаций подряд. Подождите.");

  const catalog = createServiceRoleClient();
  const displayName =
    (
      await catalog
        .from("coupon_curators")
        .select("display_name")
        .eq("profile_id", user.id)
        .maybeSingle()
    ).data?.display_name ?? null;

  const { data, error: insertError } = await catalog
    .from("coupons")
    .insert({
      curator_profile_id: user.id,
      curator_display_name: displayName,
      category_id: input.categoryId || null,
      title,
      body,
      image_url: input.imageUrl?.trim() || null,
      link_url: resolveCouponLink(input.linkUrl, body),
      promo_code: input.promoCode?.trim() || null,
      source: "direct",
    })
    .select("id")
    .single();

  if (insertError || !data) {
    return fail(insertError?.message || "Не удалось опубликовать.");
  }

  revalidatePath("/coupons");
  revalidatePath("/coupons/manage");
  return ok("Опубликовано.", data.id);
}

/** Any logged-in user proposes a coupon — goes to the curator's queue. */
export async function submitCouponAction(input: {
  title: string;
  body: string;
  imageUrl?: string | null;
  linkUrl?: string | null;
}): Promise<CouponActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 3) return fail("Заголовок слишком короткий.");
  if (body.length < 10) return fail("Опишите акцию чуть подробнее.");

  const limited = await consumeRateLimit(`coupon-submit:${user.id}`, {
    limit: 10,
    windowMs: 60 * 60 * 1000,
  });
  if (!limited.ok) return fail("Слишком много предложений подряд. Подождите.");

  const { data, error: insertError } = await supabase
    .from("coupon_submissions")
    .insert({
      submitted_by_profile_id: user.id,
      title,
      body,
      image_url: input.imageUrl?.trim() || null,
      link_url: resolveCouponLink(input.linkUrl, body),
    })
    .select("id")
    .single();

  if (insertError || !data) {
    return fail(insertError?.message || "Не удалось отправить предложение.");
  }

  revalidatePath("/coupons/manage");
  return ok("Спасибо! Куратор посмотрит и решит.", data.id);
}

/** Curator approves (publishes) or rejects a proposed post. */
export async function reviewCouponSubmissionAction(input: {
  id: string;
  decision: "approve" | "reject";
  reviewNote?: string | null;
  categoryId?: string | null;
}): Promise<CouponActionResult> {
  const { user, error } = await requireCurator();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const catalog = createServiceRoleClient();
  const { data: submission, error: fetchError } = await catalog
    .from("coupon_submissions")
    .select("id, title, body, image_url, link_url, status")
    .eq("id", input.id)
    .maybeSingle();
  if (fetchError || !submission) return fail("Предложение не найдено.");
  if (submission.status !== "pending") {
    return fail("Это предложение уже обработано.");
  }

  if (input.decision === "reject") {
    const { error: updateError } = await catalog
      .from("coupon_submissions")
      .update({
        status: "rejected",
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        review_note: input.reviewNote?.trim() || null,
      })
      .eq("id", input.id);
    if (updateError) return fail(updateError.message);
    revalidatePath("/coupons/manage");
    return ok("Отклонено.");
  }

  const displayName =
    (
      await catalog
        .from("coupon_curators")
        .select("display_name")
        .eq("profile_id", user.id)
        .maybeSingle()
    ).data?.display_name ?? null;

  const { data: coupon, error: insertError } = await catalog
    .from("coupons")
    .insert({
      curator_profile_id: user.id,
      curator_display_name: displayName,
      category_id: input.categoryId || null,
      title: submission.title,
      body: submission.body,
      image_url: submission.image_url,
      link_url: resolveCouponLink(submission.link_url, submission.body),
      source: "submission",
      source_submission_id: submission.id,
    })
    .select("id")
    .single();
  if (insertError || !coupon) {
    return fail(insertError?.message || "Не удалось опубликовать.");
  }

  const { error: updateError } = await catalog
    .from("coupon_submissions")
    .update({
      status: "approved",
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      review_note: input.reviewNote?.trim() || null,
      resulting_coupon_id: coupon.id,
    })
    .eq("id", input.id);
  if (updateError) return fail(updateError.message);

  revalidatePath("/coupons");
  revalidatePath("/coupons/manage");
  return ok("Одобрено и опубликовано.", coupon.id);
}

export async function postCouponCommentAction(input: {
  couponId: string;
  body: string;
}): Promise<CouponActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const body = input.body.trim();
  if (body.length < 1) return fail("Пустой комментарий.");
  if (body.length > 1000) return fail("Слишком длинный комментарий.");

  const limited = await consumeRateLimit(`coupon-comment:${user.id}`, {
    limit: 30,
    windowMs: 10 * 60 * 1000,
  });
  if (!limited.ok) return fail("Слишком много комментариев подряд. Подождите.");

  const { error: insertError } = await supabase.from("coupon_comments").insert({
    coupon_id: input.couponId,
    profile_id: user.id,
    body,
  });
  if (insertError) return fail(insertError.message);

  revalidatePath(`/coupons/${input.couponId}`);
  return ok();
}

export async function hideCouponCommentAction(input: {
  id: string;
  couponId: string;
}): Promise<CouponActionResult> {
  const { error } = await requireCurator();
  if (error) return error;

  const catalog = createServiceRoleClient();
  const { error: updateError } = await catalog
    .from("coupon_comments")
    .update({ status: "hidden" })
    .eq("id", input.id);
  if (updateError) return fail(updateError.message);

  revalidatePath(`/coupons/${input.couponId}`);
  return ok("Скрыто.");
}

/** Curator archives her own post (soft delete, off the public feed). */
export async function archiveCouponAction(input: {
  id: string;
}): Promise<CouponActionResult> {
  const { user, error } = await requireCurator();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const catalog = createServiceRoleClient();
  const { error: updateError } = await catalog
    .from("coupons")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", input.id);
  if (updateError) return fail(updateError.message);

  revalidatePath("/coupons");
  revalidatePath("/coupons/manage");
  return ok("Пост убран из ленты.");
}

/** Admin-only: grant/revoke curator status. Called from /admin/users. */
export async function adminSetCouponCuratorAction(input: {
  userId: string;
  displayName?: string | null;
  remove?: boolean;
}): Promise<CouponActionResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Нужно войти в аккаунт.");
  if (!(await userIsAdmin(supabase))) return fail("Только для администраторов.");

  const catalog = createServiceRoleClient();
  if (input.remove) {
    const { error } = await catalog
      .from("coupon_curators")
      .delete()
      .eq("profile_id", input.userId);
    if (error) return fail(error.message);
    revalidatePath("/admin/users");
    return ok("Права куратора сняты.");
  }

  const { error } = await catalog.from("coupon_curators").upsert({
    profile_id: input.userId,
    display_name: input.displayName?.trim() || null,
  });
  if (error) return fail(error.message);
  revalidatePath("/admin/users");
  return ok("Назначен куратором «Купонинга».");
}
