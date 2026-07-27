"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";

export type EngagementActionResult =
  | { ok: true; message?: string; clearedOpposite?: boolean }
  | { ok: false; message: string };

function fail(message: string): EngagementActionResult {
  return { ok: false, message };
}

function ok(
  message?: string,
  extra?: { clearedOpposite?: boolean },
): EngagementActionResult {
  return { ok: true, message, ...extra };
}

function mapDbError(error: { message?: string; code?: string } | null): string {
  const message = (error?.message ?? "").toLowerCase();
  if (message.includes("authentication required")) {
    return "Нужно войти в аккаунт.";
  }
  if (message.includes("not engagable") || message.includes("not found")) {
    return "Нельзя поставить отметку для этой карточки.";
  }
  if (error?.code === "23505") {
    return "Уже отмечено.";
  }
  return "Не удалось сохранить. Попробуйте ещё раз.";
}

async function requireUser() {
  const supabase = await createServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return { supabase, user: null, error: fail("Нужно войти в аккаунт.") };
  }
  return { supabase, user, error: null as EngagementActionResult | null };
}

function db(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
): SupabaseClient {
  return supabase as unknown as SupabaseClient;
}

export async function likeBusinessAction(
  businessId: string,
  businessSlug: string,
): Promise<EngagementActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const client = db(supabase);
  const { data: cleared } = await client
    .from("business_dislikes")
    .delete()
    .eq("business_id", businessId)
    .eq("user_id", user.id)
    .select("business_id");

  const { error: insertError } = await client
    .from("business_likes")
    .insert({ business_id: businessId });

  if (insertError) {
    if (insertError.code === "23505") return ok("Уже в лайках.");
    return fail(mapDbError(insertError));
  }

  revalidatePath(`/business/${businessSlug}`);
  return ok("Лайк сохранён.", {
    clearedOpposite: Boolean(cleared?.length),
  });
}

export async function unlikeBusinessAction(
  businessId: string,
  businessSlug: string,
): Promise<EngagementActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const { error: deleteError } = await db(supabase)
    .from("business_likes")
    .delete()
    .eq("business_id", businessId)
    .eq("user_id", user.id);

  if (deleteError) return fail(mapDbError(deleteError));

  revalidatePath(`/business/${businessSlug}`);
  return ok("Лайк убран.");
}

export async function dislikeBusinessAction(
  businessId: string,
  businessSlug: string,
): Promise<EngagementActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const client = db(supabase);
  const { data: cleared } = await client
    .from("business_likes")
    .delete()
    .eq("business_id", businessId)
    .eq("user_id", user.id)
    .select("business_id");

  const { error: insertError } = await client
    .from("business_dislikes")
    .insert({ business_id: businessId });

  if (insertError) {
    if (insertError.code === "23505") return ok("Уже в дизлайках.");
    return fail(mapDbError(insertError));
  }

  revalidatePath(`/business/${businessSlug}`);
  return ok("Дизлайк сохранён.", {
    clearedOpposite: Boolean(cleared?.length),
  });
}

export async function undislikeBusinessAction(
  businessId: string,
  businessSlug: string,
): Promise<EngagementActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const { error: deleteError } = await db(supabase)
    .from("business_dislikes")
    .delete()
    .eq("business_id", businessId)
    .eq("user_id", user.id);

  if (deleteError) return fail(mapDbError(deleteError));

  revalidatePath(`/business/${businessSlug}`);
  return ok("Дизлайк убран.");
}

export async function followBusinessAction(
  businessId: string,
  businessSlug: string,
): Promise<EngagementActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const { error: insertError } = await db(supabase)
    .from("business_followers")
    .insert({ business_id: businessId });

  if (insertError) {
    if (insertError.code === "23505") return ok("Уже в подписках.");
    return fail(mapDbError(insertError));
  }

  revalidatePath(`/business/${businessSlug}`);
  return ok("Подписка оформлена.");
}

export async function unfollowBusinessAction(
  businessId: string,
  businessSlug: string,
): Promise<EngagementActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const { error: deleteError } = await db(supabase)
    .from("business_followers")
    .delete()
    .eq("business_id", businessId)
    .eq("user_id", user.id);

  if (deleteError) return fail(mapDbError(deleteError));

  revalidatePath(`/business/${businessSlug}`);
  return ok("Подписка отменена.");
}

export async function likeProfessionalAction(
  professionalId: string,
  professionalSlug: string,
): Promise<EngagementActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const client = db(supabase);
  const { data: cleared } = await client
    .from("professional_dislikes")
    .delete()
    .eq("professional_id", professionalId)
    .eq("user_id", user.id)
    .select("professional_id");

  const { error: insertError } = await client
    .from("professional_likes")
    .insert({ professional_id: professionalId });

  if (insertError) {
    if (insertError.code === "23505") return ok("Уже в лайках.");
    return fail(mapDbError(insertError));
  }

  revalidatePath(`/professional/${professionalSlug}`);
  return ok("Лайк сохранён.", {
    clearedOpposite: Boolean(cleared?.length),
  });
}

export async function unlikeProfessionalAction(
  professionalId: string,
  professionalSlug: string,
): Promise<EngagementActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const { error: deleteError } = await db(supabase)
    .from("professional_likes")
    .delete()
    .eq("professional_id", professionalId)
    .eq("user_id", user.id);

  if (deleteError) return fail(mapDbError(deleteError));

  revalidatePath(`/professional/${professionalSlug}`);
  return ok("Лайк убран.");
}

export async function dislikeProfessionalAction(
  professionalId: string,
  professionalSlug: string,
): Promise<EngagementActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const client = db(supabase);
  const { data: cleared } = await client
    .from("professional_likes")
    .delete()
    .eq("professional_id", professionalId)
    .eq("user_id", user.id)
    .select("professional_id");

  const { error: insertError } = await client
    .from("professional_dislikes")
    .insert({ professional_id: professionalId });

  if (insertError) {
    if (insertError.code === "23505") return ok("Уже в дизлайках.");
    return fail(mapDbError(insertError));
  }

  revalidatePath(`/professional/${professionalSlug}`);
  return ok("Дизлайк сохранён.", {
    clearedOpposite: Boolean(cleared?.length),
  });
}

export async function undislikeProfessionalAction(
  professionalId: string,
  professionalSlug: string,
): Promise<EngagementActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const { error: deleteError } = await db(supabase)
    .from("professional_dislikes")
    .delete()
    .eq("professional_id", professionalId)
    .eq("user_id", user.id);

  if (deleteError) return fail(mapDbError(deleteError));

  revalidatePath(`/professional/${professionalSlug}`);
  return ok("Дизлайк убран.");
}

export async function followProfessionalAction(
  professionalId: string,
  professionalSlug: string,
): Promise<EngagementActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const { error: insertError } = await db(supabase)
    .from("professional_followers")
    .insert({ professional_id: professionalId });

  if (insertError) {
    if (insertError.code === "23505") return ok("Уже в подписках.");
    return fail(mapDbError(insertError));
  }

  revalidatePath(`/professional/${professionalSlug}`);
  return ok("Подписка оформлена.");
}

export async function unfollowProfessionalAction(
  professionalId: string,
  professionalSlug: string,
): Promise<EngagementActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const { error: deleteError } = await db(supabase)
    .from("professional_followers")
    .delete()
    .eq("professional_id", professionalId)
    .eq("user_id", user.id);

  if (deleteError) return fail(mapDbError(deleteError));

  revalidatePath(`/professional/${professionalSlug}`);
  return ok("Подписка отменена.");
}
