"use server";

import { userOwnsProfessional } from "@/lib/professional/queries";
import { createServerClient } from "@/lib/supabase/server";
import type {
  ClaimProofInput,
  ClaimStateResult,
  ClaimSubmitResult,
} from "@/lib/claims/actions";

function managePathFor(slug: string) {
  return `/professional/${slug}/edit`;
}

function loginPathFor(slug: string) {
  return `/login?next=${encodeURIComponent(`/professional/${slug}?claim=1`)}`;
}

function buildVerificationDetails(proof: ClaimProofInput): string {
  const lines: string[] = [];
  const phone = proof.phone.trim();
  if (phone) lines.push(`phone: ${phone}`);
  const website = proof.website?.trim();
  if (website) lines.push(`website: ${website}`);
  const ig = proof.instagramUrl?.trim();
  if (ig) lines.push(`instagram: ${ig}`);
  const fb = proof.facebookUrl?.trim();
  if (fb) lines.push(`facebook: ${fb}`);
  const yelp = proof.yelpUrl?.trim();
  if (yelp) lines.push(`yelp: ${yelp}`);
  return lines.join("\n").slice(0, 4000);
}

export async function getProfessionalClaimStateAction(
  professionalId: string,
  professionalSlug: string,
): Promise<ClaimStateResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      state: "needs_auth",
      message: "Войдите, чтобы подтвердить профиль специалиста.",
      loginPath: loginPathFor(professionalSlug),
    };
  }

  const owns = await userOwnsProfessional(supabase, professionalId);
  if (owns) {
    return {
      ok: true,
      state: "owned",
      message: "Вы уже управляете этим профилем.",
      managePath: managePathFor(professionalSlug),
    };
  }

  const { data: pending, error } = await supabase
    .from("professional_claims")
    .select("id")
    .eq("professional_id", professionalId)
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

export async function claimProfessionalAction(
  professionalId: string,
  professionalSlug: string,
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
      message: "Войдите, чтобы подтвердить профиль специалиста.",
      loginPath: loginPathFor(professionalSlug),
    };
  }

  const owns = await userOwnsProfessional(supabase, professionalId);
  if (owns) {
    return {
      ok: true,
      state: "owned",
      message: "Вы уже управляете этим профилем.",
      managePath: managePathFor(professionalSlug),
    };
  }

  const { data: existingPending } = await supabase
    .from("professional_claims")
    .select("id")
    .eq("professional_id", professionalId)
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

  let applicantMessage: string | null = null;
  let verificationDetails: string | null = null;

  if (typeof proof === "string") {
    applicantMessage = proof.trim() ? proof.trim().slice(0, 1000) : null;
  } else if (proof) {
    const phone = proof.phone?.trim() ?? "";
    if (!phone) {
      return {
        ok: false,
        state: "error",
        message: "Укажите телефон для связи.",
      };
    }
    const links = [
      proof.website,
      proof.instagramUrl,
      proof.facebookUrl,
      proof.yelpUrl,
    ].filter((v) => Boolean(v?.trim()));
    if (links.length === 0) {
      return {
        ok: false,
        state: "error",
        message: "Добавьте хотя бы одну ссылку как доказательство.",
      };
    }
    verificationDetails = buildVerificationDetails(proof);
    applicantMessage =
      typeof proof.message === "string" && proof.message.trim()
        ? proof.message.trim().slice(0, 1000)
        : null;
  }

  const { error } = await supabase.from("professional_claims").insert({
    professional_id: professionalId,
    user_id: user.id,
    applicant_message: applicantMessage,
    verification_details: verificationDetails,
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
    message: "Заявка отправлена. Мы проверим и откроем доступ к редактированию.",
  };
}
