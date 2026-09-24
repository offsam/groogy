"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import {
  createServiceDraftAction,
  pauseListingAction,
  reactivateListingAction,
} from "@/lib/listings/actions";
import { MIN_DESCRIPTION, MIN_TITLE } from "@/types/listing";

export type SkillFrameActionResult =
  | {
      ok: true;
      message?: string;
      frameId?: string;
      listingId?: string;
      redirectTo?: string;
    }
  | { ok: false; message: string };

function fail(message: string): SkillFrameActionResult {
  return { ok: false, message };
}

function ok(
  message?: string,
  extra?: { frameId?: string; listingId?: string; redirectTo?: string },
): SkillFrameActionResult {
  return { ok: true, message, ...extra };
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

async function revalidateOwnerProfile(userId: string) {
  revalidatePath("/profile");
  const supabase = await createServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from("profiles")
    .select("username")
    .eq("id", userId)
    .maybeSingle();
  if (data?.username) {
    revalidatePath(`/u/${data.username}`);
  }
}

function buildDescription(input: {
  skills: string;
  workplace: string | null;
  specialty: string | null;
}): string {
  const parts = [
    input.skills.trim(),
    input.specialty?.trim() ? `Специальность: ${input.specialty.trim()}` : "",
    input.workplace?.trim() ? `Место работы: ${input.workplace.trim()}` : "",
  ].filter(Boolean);
  let text = parts.join("\n\n");
  if (text.length < MIN_DESCRIPTION) {
    text = `${text}\n\nУслуги и навыки на платформе КРУГИ.`.trim();
  }
  return text.slice(0, 4000);
}

export async function createSkillFrameAction(): Promise<SkillFrameActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: last } = await db
    .from("profile_skill_frames")
    .select("sort_order")
    .eq("user_id", user.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sortOrder = (last?.sort_order ?? 0) + 1;
  const { data, error: insertError } = await db
    .from("profile_skill_frames")
    .insert({
      user_id: user.id,
      title: "",
      skills: "",
      sort_order: sortOrder,
    })
    .select("id")
    .single();

  if (insertError || !data) {
    return fail(insertError?.message ?? "Не удалось создать фрейм.");
  }

  await revalidateOwnerProfile(user.id);
  return ok("Фрейм добавлен.", { frameId: data.id });
}

export async function saveSkillFrameAction(input: {
  frameId: string;
  title: string;
  skills: string;
  workplace: string;
  specialty: string;
}): Promise<SkillFrameActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { error: updateError } = await db
    .from("profile_skill_frames")
    .update({
      title: input.title.trim().slice(0, 120),
      skills: input.skills.trim().slice(0, 4000),
      workplace: input.workplace.trim().slice(0, 200) || null,
      specialty: input.specialty.trim().slice(0, 200) || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.frameId)
    .eq("user_id", user.id);

  if (updateError) return fail(updateError.message);

  await revalidateOwnerProfile(user.id);
  return ok("Сохранено.", { frameId: input.frameId });
}

export async function deleteSkillFrameAction(
  frameId: string,
): Promise<SkillFrameActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { error: deleteError } = await db
    .from("profile_skill_frames")
    .delete()
    .eq("id", frameId)
    .eq("user_id", user.id);

  if (deleteError) return fail(deleteError.message);
  await revalidateOwnerProfile(user.id);
  return ok("Фрейм удалён.");
}

export async function setSkillFrameShowPublicAction(
  frameId: string,
  showPublic: boolean,
): Promise<SkillFrameActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { error: updateError } = await db
    .from("profile_skill_frames")
    .update({
      show_public: showPublic,
      updated_at: new Date().toISOString(),
    })
    .eq("id", frameId)
    .eq("user_id", user.id);

  if (updateError) return fail(updateError.message);
  await revalidateOwnerProfile(user.id);
  return ok(showPublic ? "Видно гостям." : "Скрыто от гостей.", { frameId });
}

export async function setSkillFrameActiveAction(
  frameId: string,
  active: boolean,
): Promise<SkillFrameActionResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: frame, error: fetchError } = await db
    .from("profile_skill_frames")
    .select(
      "id, title, skills, workplace, specialty, listing_id, is_active",
    )
    .eq("id", frameId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchError) return fail(fetchError.message);
  if (!frame) return fail("Фрейм не найден.");

  const title = String(frame.title ?? "").trim();
  const skills = String(frame.skills ?? "").trim();

  if (active) {
    if (title.length < MIN_TITLE) {
      return fail(`Укажите специальность (от ${MIN_TITLE} символов).`);
    }
    if (skills.length < 3) {
      return fail("Опишите навыки подробнее.");
    }

    if (!frame.listing_id) {
      const description = buildDescription({
        skills,
        workplace: frame.workplace,
        specialty: frame.specialty,
      });
      const created = await createServiceDraftAction({
        title,
        description,
        city: null,
        state: null,
        visibility: "public",
        authorVisibility: "public",
        serviceCategoryId: null,
        pricingType: "contact_for_price",
        priceFrom: null,
        priceTo: null,
        priceUnit: null,
        serviceModes: ["in_person"],
        serviceArea: null,
        experienceYears: null,
        languages: ["ru"],
        licenseInfo: null,
        insuranceStatus: null,
        availabilityText: null,
        offersFreeEstimate: false,
        offersEmergencyService: false,
        isNegotiable: true,
        publisherType: "profile",
        publisherBusinessId: null,
      });
      if (!created.ok || !created.listingId) {
        return fail(created.ok ? "Не удалось создать объявление." : created.message);
      }

      await db
        .from("profile_skill_frames")
        .update({
          listing_id: created.listingId,
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", frameId)
        .eq("user_id", user.id);

      await revalidateOwnerProfile(user.id);
      return ok(
        "Объявление создано — проверьте и опубликуйте.",
        {
          frameId,
          listingId: created.listingId,
          redirectTo: `/services/${created.listingId}/edit`,
        },
      );
    }

    const { data: listing } = await db
      .from("listings")
      .select("id, status")
      .eq("id", frame.listing_id)
      .eq("owner_id", user.id)
      .maybeSingle();

    if (!listing) {
      return fail("Связанное объявление не найдено.");
    }

    if (listing.status === "draft") {
      await revalidateOwnerProfile(user.id);
      return ok("Дополните и опубликуйте объявление.", {
        frameId,
        listingId: listing.id,
        redirectTo: `/services/${listing.id}/edit`,
      });
    }

    if (listing.status !== "active") {
      const reactivated = await reactivateListingAction(listing.id);
      if (!reactivated.ok) return fail(reactivated.message);
    }

    await db
      .from("profile_skill_frames")
      .update({
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", frameId)
      .eq("user_id", user.id);

    await revalidateOwnerProfile(user.id);
    return ok("Объявление активировано.", {
      frameId,
      listingId: listing.id,
    });
  }

  if (frame.listing_id) {
    const paused = await pauseListingAction(frame.listing_id);
    if (!paused.ok && !paused.message.includes("уже")) {
      // Still flip local flag if pause failed for non-active listing
    }
  }

  await db
    .from("profile_skill_frames")
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", frameId)
    .eq("user_id", user.id);

  await revalidateOwnerProfile(user.id);
  return ok("Объявление снято с публикации.", { frameId });
}
