"use server";

import { createServerClient } from "@/lib/supabase/server";
import { userOwnsBusiness } from "@/lib/reviews/queries";

export type ClaimStateResult =
  | {
      ok: true;
      state: "owned" | "pending" | "available";
      message?: string;
      managePath?: string;
    }
  | {
      ok: false;
      state: "needs_auth" | "error";
      message: string;
      loginPath?: string;
    };

export type ClaimSubmitResult =
  | {
      ok: true;
      state: "owned" | "pending" | "created";
      message: string;
      managePath?: string;
    }
  | {
      ok: false;
      state: "needs_auth" | "error";
      message: string;
      loginPath?: string;
    };

function managePathFor(slug: string) {
  return `/business/${slug}/manage`;
}

function loginPathFor(slug: string) {
  return `/login?next=${encodeURIComponent(`/business/${slug}?claim=1`)}`;
}

export async function getBusinessClaimStateAction(
  businessId: string,
  businessSlug: string,
): Promise<ClaimStateResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      state: "needs_auth",
      message: "Войдите, чтобы подтвердить бизнес.",
      loginPath: loginPathFor(businessSlug),
    };
  }

  const owns = await userOwnsBusiness(supabase, businessId);
  if (owns) {
    return {
      ok: true,
      state: "owned",
      message: "Вы уже управляете этим бизнесом.",
      managePath: managePathFor(businessSlug),
    };
  }

  const { data: pending, error } = await supabase
    .from("business_claims")
    .select("id")
    .eq("business_id", businessId)
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

export async function claimBusinessAction(
  businessId: string,
  businessSlug: string,
  message?: string,
): Promise<ClaimSubmitResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      state: "needs_auth",
      message: "Войдите, чтобы подтвердить бизнес.",
      loginPath: loginPathFor(businessSlug),
    };
  }

  const owns = await userOwnsBusiness(supabase, businessId);
  if (owns) {
    return {
      ok: true,
      state: "owned",
      message: "Вы уже управляете этим бизнесом.",
      managePath: managePathFor(businessSlug),
    };
  }

  const { data: existingPending } = await supabase
    .from("business_claims")
    .select("id")
    .eq("business_id", businessId)
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

  const applicantMessage =
    typeof message === "string" && message.trim()
      ? message.trim().slice(0, 1000)
      : null;

  // Do not set `status` — column INSERT is denied; DB default is pending.
  const { error } = await supabase.from("business_claims").insert({
    business_id: businessId,
    user_id: user.id,
    applicant_message: applicantMessage,
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
    message: "Заявка отправлена. Мы проверим и откроем доступ к управлению.",
  };
}
