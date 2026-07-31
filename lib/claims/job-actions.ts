"use server";

import { createServerClient } from "@/lib/supabase/server";
import {
  parseClaimProof,
  type ClaimProofInput,
  type ClaimStateResult,
  type ClaimSubmitResult,
} from "@/lib/claims/shared";

function managePathFor(slug: string) {
  return `/jobs/${slug}`;
}

function loginPathFor(slug: string) {
  return `/login?next=${encodeURIComponent(`/jobs/${slug}?claim=1`)}`;
}

async function userOwnsJob(jobId: string, userId: string): Promise<boolean> {
  const supabase = await createServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jobs select depth
  const { data } = await (supabase as any)
    .from("jobs")
    .select("owner_profile_id")
    .eq("id", jobId)
    .maybeSingle();
  return Boolean(data?.owner_profile_id === userId);
}

export async function getJobClaimStateAction(
  jobId: string,
  jobSlug: string,
): Promise<ClaimStateResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      state: "needs_auth",
      message: "Войдите, чтобы подтвердить вакансию.",
      loginPath: loginPathFor(jobSlug),
    };
  }

  if (await userOwnsJob(jobId, user.id)) {
    return {
      ok: true,
      state: "owned",
      message: "Вы уже управляете этой вакансией.",
      managePath: managePathFor(jobSlug),
    };
  }

  const { data: pending, error } = await supabase
    .from("job_claims")
    .select("id")
    .eq("job_id", jobId)
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

export async function claimJobAction(
  jobId: string,
  jobSlug: string,
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
      message: "Войдите, чтобы подтвердить вакансию.",
      loginPath: loginPathFor(jobSlug),
    };
  }

  if (await userOwnsJob(jobId, user.id)) {
    return {
      ok: true,
      state: "owned",
      message: "Вы уже управляете этой вакансией.",
      managePath: managePathFor(jobSlug),
    };
  }

  const { data: existingPending } = await supabase
    .from("job_claims")
    .select("id")
    .eq("job_id", jobId)
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

  const { error } = await supabase.from("job_claims").insert({
    job_id: jobId,
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
