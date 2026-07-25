"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export type AdminActionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string };

export type PendingBusinessClaim = {
  id: string;
  businessId: string;
  businessSlug: string;
  businessName: string;
  userId: string;
  applicantDisplayName: string | null;
  applicantEmail: string | null;
  verificationMethod: string | null;
  verificationDetails: string | null;
  applicantMessage: string | null;
  createdAt: string;
};

function fail(message: string): AdminActionResult {
  return { ok: false, message };
}

function ok(message?: string): AdminActionResult {
  return { ok: true, message };
}

async function requireAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, user: null, error: fail("Нужно войти в аккаунт.") };
  }
  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    return { supabase, user, error: fail("Только для администраторов.") };
  }
  return { supabase, user, error: null };
}

export async function getPendingBusinessClaims(): Promise<PendingBusinessClaim[]> {
  const { supabase, error } = await requireAdmin();
  if (error) return [];

  const { data, error: rpcError } = await supabase.rpc(
    "admin_list_pending_business_claims",
  );
  if (rpcError || !data) return [];

  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    businessId: String(row.business_id),
    businessSlug: String(row.business_slug ?? ""),
    businessName: String(row.business_name ?? ""),
    userId: String(row.user_id),
    applicantDisplayName:
      typeof row.applicant_display_name === "string"
        ? row.applicant_display_name
        : null,
    applicantEmail:
      typeof row.applicant_email === "string" ? row.applicant_email : null,
    verificationMethod:
      typeof row.verification_method === "string"
        ? row.verification_method
        : null,
    verificationDetails:
      typeof row.verification_details === "string"
        ? row.verification_details
        : null,
    applicantMessage:
      typeof row.applicant_message === "string" ? row.applicant_message : null,
    createdAt: String(row.created_at ?? ""),
  }));
}

export async function adminReviewBusinessClaimAction(input: {
  claimId: string;
  decision: "approved" | "rejected";
  moderatorNote?: string | null;
}): Promise<AdminActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { error: rpcError } = await supabase.rpc("admin_review_business_claim", {
    p_claim_id: input.claimId,
    p_decision: input.decision,
    p_moderator_note: input.moderatorNote?.trim() || null,
  });

  if (rpcError) {
    const msg = (rpcError.message ?? "").toLowerCase();
    if (msg.includes("admin only")) return fail("Только для администраторов.");
    if (msg.includes("claim not found")) return fail("Заявка не найдена.");
    if (msg.includes("not pending")) return fail("Заявка уже обработана.");
    return fail(rpcError.message || "Не удалось обработать заявку.");
  }

  revalidatePath("/admin/claims");
  revalidatePath("/admin");
  return ok(
    input.decision === "approved" ? "Заявка одобрена." : "Заявка отклонена.",
  );
}
