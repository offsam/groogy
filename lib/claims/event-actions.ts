"use server";

import { createServerClient } from "@/lib/supabase/server";
import {
  parseClaimProof,
  type ClaimProofInput,
  type ClaimStateResult,
  type ClaimSubmitResult,
} from "@/lib/claims/shared";

function managePathFor(slug: string) {
  return `/events/${slug}`;
}

function loginPathFor(slug: string) {
  return `/login?next=${encodeURIComponent(`/events/${slug}?claim=1`)}`;
}

async function userOwnsEvent(
  eventId: string,
  userId: string,
): Promise<boolean> {
  const supabase = await createServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- events pending in Database types
  const { data } = await (supabase as any)
    .from("events")
    .select("owner_profile_id")
    .eq("id", eventId)
    .maybeSingle();
  return Boolean(data?.owner_profile_id === userId);
}

export async function getEventClaimStateAction(
  eventId: string,
  eventSlug: string,
): Promise<ClaimStateResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      state: "needs_auth",
      message: "Войдите, чтобы подтвердить событие.",
      loginPath: loginPathFor(eventSlug),
    };
  }

  if (await userOwnsEvent(eventId, user.id)) {
    return {
      ok: true,
      state: "owned",
      message: "Вы уже управляете этим событием.",
      managePath: managePathFor(eventSlug),
    };
  }

  const { data: pending, error } = await supabase
    .from("event_claims")
    .select("id")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .eq("status", "pending")
    .maybeSingle();

  if (error) {
    return { ok: false, state: "error", message: "Не удалось проверить заявку." };
  }
  if (pending) {
    return {
      ok: true,
      state: "pending",
      message: "Заявка уже отправлена и ждёт проверки.",
    };
  }
  return { ok: true, state: "available" };
}

export async function claimEventAction(
  eventId: string,
  eventSlug: string,
  proof?: ClaimProofInput | string,
): Promise<ClaimSubmitResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      state: "needs_auth",
      message: "Войдите, чтобы подтвердить событие.",
      loginPath: loginPathFor(eventSlug),
    };
  }

  if (await userOwnsEvent(eventId, user.id)) {
    return {
      ok: true,
      state: "owned",
      message: "Вы уже управляете этим событием.",
      managePath: managePathFor(eventSlug),
    };
  }

  const { data: existingPending } = await supabase
    .from("event_claims")
    .select("id")
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .eq("status", "pending")
    .maybeSingle();

  if (existingPending) {
    return {
      ok: true,
      state: "pending",
      message: "Заявка уже отправлена и ждёт проверки.",
    };
  }

  const parsed = parseClaimProof(proof);
  if (parsed.error) {
    return { ok: false, state: "error", message: parsed.error };
  }

  const { error } = await supabase.from("event_claims").insert({
    event_id: eventId,
    user_id: user.id,
    applicant_message: parsed.applicantMessage,
    verification_details: parsed.verificationDetails,
    verification_method: "owner_self_claim",
  });

  if (error) {
    if (error.code === "23505") {
      return {
        ok: true,
        state: "pending",
        message: "Заявка уже отправлена и ждёт проверки.",
      };
    }
    return {
      ok: false,
      state: "error",
      message: "Не удалось отправить заявку. Попробуйте ещё раз.",
    };
  }

  return {
    ok: true,
    state: "created",
    message: "Заявка отправлена. Мы проверим и откроем доступ.",
  };
}
