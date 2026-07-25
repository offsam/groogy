"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export type BusinessAdminActionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string };

function fail(message: string): BusinessAdminActionResult {
  return { ok: false, message };
}

function ok(message?: string): BusinessAdminActionResult {
  return { ok: true, message };
}

function mapDbError(error: { message?: string } | null): string {
  const message = (error?.message ?? "").toLowerCase();
  if (message.includes("admin only")) return "Только для администраторов.";
  if (message.includes("not found")) return "Бизнес не найден.";
  if (message.includes("must differ")) return "Нужно выбрать две разные карточки.";
  return error?.message || "Не удалось выполнить действие.";
}

async function requireAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, error: fail("Нужно войти в аккаунт.") };
  }
  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    return { supabase, error: fail("Только для администраторов.") };
  }
  return { supabase, error: null };
}

function revalidateBusinessAdmin(keepSlug?: string | null, dropSlug?: string | null) {
  revalidatePath("/admin/businesses");
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath("/map");
  if (keepSlug) {
    revalidatePath(`/business/${keepSlug}`);
    revalidatePath(`/businesses/${keepSlug}`);
  }
  if (dropSlug) {
    revalidatePath(`/business/${dropSlug}`);
    revalidatePath(`/businesses/${dropSlug}`);
  }
}

export async function adminSetBusinessStatusAction(input: {
  businessId: string;
  status: "pending" | "approved" | "rejected" | "archived";
  slug?: string | null;
}): Promise<BusinessAdminActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { error: rpcError } = await supabase.rpc("admin_set_business_status", {
    p_business_id: input.businessId,
    p_status: input.status,
  });
  if (rpcError) return fail(mapDbError(rpcError));

  revalidateBusinessAdmin(input.slug);
  return ok("Статус обновлён.");
}

export async function mergeBusinessesAction(input: {
  keepId: string;
  dropId: string;
  keepSlug?: string | null;
  dropSlug?: string | null;
}): Promise<BusinessAdminActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { data, error: rpcError } = await supabase.rpc("admin_merge_businesses", {
    p_keep_id: input.keepId,
    p_drop_id: input.dropId,
  });
  if (rpcError) return fail(mapDbError(rpcError));

  const stats = (data ?? {}) as {
    offers_moved?: number;
    reviews_moved?: number;
    owners_moved?: number;
  };
  const parts = [
    `офферов: ${stats.offers_moved ?? 0}`,
    `отзывов: ${stats.reviews_moved ?? 0}`,
    `владельцев: ${stats.owners_moved ?? 0}`,
  ];

  revalidateBusinessAdmin(input.keepSlug, input.dropSlug);
  return ok(`Смержено. Перенесено — ${parts.join(", ")}. Дубликат в архиве.`);
}
