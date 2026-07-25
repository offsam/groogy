"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import type { UserRole } from "@/types/database";

export type AdminActionResult =
  | { ok: true; message?: string; id?: string }
  | { ok: false; message: string };

function fail(message: string): AdminActionResult {
  return { ok: false, message };
}

function ok(message?: string, id?: string): AdminActionResult {
  return { ok: true, message, id };
}

function mapDbError(error: { message?: string } | null): string {
  const message = (error?.message ?? "").toLowerCase();
  if (message.includes("admin only")) return "Только для администраторов.";
  if (message.includes("cannot demote yourself")) {
    return "Нельзя снять права у самого себя.";
  }
  if (message.includes("cannot remove the last admin")) {
    return "Нельзя удалить последнего администратора.";
  }
  if (message.includes("user not found")) return "Пользователь не найден.";
  if (message.includes("business not found")) return "Бизнес не найден.";
  if (message.includes("name required")) return "Укажите название.";
  if (message.includes("slug required")) return "Укажите slug.";
  return error?.message || "Не удалось выполнить действие.";
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

export async function adminSetUserRoleAction(input: {
  userId: string;
  role: UserRole;
}): Promise<AdminActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { error: rpcError } = await supabase.rpc("admin_set_user_role", {
    p_user_id: input.userId,
    p_role: input.role,
  });
  if (rpcError) return fail(mapDbError(rpcError));

  revalidatePath("/admin/users");
  revalidatePath("/admin");
  return ok(
    input.role === "admin"
      ? "Пользователь назначен администратором."
      : "Роль обновлена.",
  );
}

export async function adminDeleteBusinessAction(input: {
  businessId: string;
  slug?: string | null;
}): Promise<AdminActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { error: rpcError } = await supabase.rpc("admin_delete_business", {
    p_business_id: input.businessId,
  });
  if (rpcError) return fail(mapDbError(rpcError));

  revalidatePath("/admin/businesses");
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath("/map");
  if (input.slug) {
    revalidatePath(`/business/${input.slug}`);
  }
  return ok("Бизнес скрыт (архив).");
}

export async function adminUpsertBusinessAction(input: {
  id?: string | null;
  name: string;
  slug: string;
  shortDescription?: string;
  description?: string;
  phone?: string;
  website?: string;
  city?: string;
  addressLine?: string;
  status?: "pending" | "approved" | "rejected" | "archived" | "draft";
  categoryId?: string | null;
  instagramUrl?: string;
  googleMapsUrl?: string;
  googleRating?: number | null;
  googleReviewsCount?: number | null;
}): Promise<AdminActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { data, error: rpcError } = await supabase.rpc("admin_upsert_business", {
    p_id: input.id ?? null,
    p_name: input.name,
    p_slug: input.slug,
    p_short_description: input.shortDescription ?? "",
    p_description: input.description ?? "",
    p_phone: input.phone ?? "",
    p_website: input.website ?? "",
    p_city: input.city ?? "",
    p_address_line: input.addressLine ?? "",
    p_status: input.status ?? "pending",
    p_category_id: input.categoryId ?? null,
    p_instagram_url: input.instagramUrl ?? "",
    p_google_maps_url: input.googleMapsUrl ?? "",
    p_google_rating: input.googleRating ?? null,
    p_google_reviews_count: input.googleReviewsCount ?? 0,
  });
  if (rpcError) return fail(mapDbError(rpcError));

  revalidatePath("/admin/businesses");
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath(`/business/${input.slug}`);
  return ok(
    input.id ? "Бизнес обновлён." : "Бизнес создан.",
    typeof data === "string" ? data : undefined,
  );
}

export async function trackPageViewAction(input: {
  path: string;
  referrer?: string | null;
}): Promise<void> {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("platform_events").insert({
      event_type: "page_view",
      path: input.path.slice(0, 500) || "/",
      referrer: input.referrer?.slice(0, 500) || null,
      user_id: user?.id ?? null,
      meta: {},
    });
  } catch {
    // Analytics must never break the page.
  }
}

export async function trackContactRevealAction(input: {
  businessId: string;
  businessSlug: string;
  offerId?: string | null;
  offerSlug?: string | null;
  surface: "business" | "offer";
  path?: string | null;
}): Promise<void> {
  try {
    if (!input.businessId || !input.businessSlug) return;
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const path =
      input.path?.slice(0, 500) ||
      (input.offerSlug
        ? `/business/${input.businessSlug}/offers/${input.offerSlug}`
        : `/business/${input.businessSlug}`);
    await supabase.from("platform_events").insert({
      event_type: "contact_reveal",
      path,
      referrer: null,
      user_id: user?.id ?? null,
      meta: {
        business_id: input.businessId,
        business_slug: input.businessSlug,
        offer_id: input.offerId ?? null,
        offer_slug: input.offerSlug ?? null,
        surface: input.surface,
      },
    });
  } catch {
    // Analytics must never break the page.
  }
}
