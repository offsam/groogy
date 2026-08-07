"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { businessDetailTag } from "@/lib/platform/catalog-cache";
import {
  buildCatalogMergeBaggage,
  CATALOG_MERGE_BAGGAGE_SELECT,
  enrichCatalogMergeChildren,
  preserveSecondaryMergeSource,
  retargetCatalogMergeProvenance,
} from "@/lib/admin/catalog-merge-baggage";
import { userIsAdmin } from "@/lib/reviews/queries";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

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
    revalidateTag(businessDetailTag(keepSlug));
  }
  if (dropSlug) {
    revalidatePath(`/business/${dropSlug}`);
    revalidatePath(`/businesses/${dropSlug}`);
    revalidateTag(businessDetailTag(dropSlug));
  }
}

export async function adminSetBusinessStatusAction(input: {
  businessId: string;
  status: "pending" | "approved" | "rejected" | "archived" | "deferred";
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

export async function adminSetBusinessCategoryAction(input: {
  businessId: string;
  categoryId: string | null;
  slug?: string | null;
}): Promise<BusinessAdminActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { error: rpcError } = await supabase.rpc("admin_set_business_category", {
    p_business_id: input.businessId,
    p_category_id: input.categoryId,
  });
  if (rpcError) {
    const message = (rpcError.message ?? "").toLowerCase();
    if (message.includes("category not found")) {
      return fail("Категория не найдена или неактивна.");
    }
    return fail(mapDbError(rpcError));
  }

  revalidateBusinessAdmin(input.slug);
  revalidatePath("/search");
  return ok("Категория обновлена.");
}

export async function mergeBusinessesAction(input: {
  keepId: string;
  dropId: string;
  keepSlug?: string | null;
  dropSlug?: string | null;
}): Promise<BusinessAdminActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  let catalog = supabase as ReturnType<typeof createServiceRoleClient>;
  try {
    catalog = createServiceRoleClient();
  } catch {
    // Fall back to the admin session client.
  }

  const { data: keepRow } = await catalog
    .from("businesses")
    .select(CATALOG_MERGE_BAGGAGE_SELECT.business)
    .eq("id", input.keepId)
    .maybeSingle();
  const { data: dropRow } = await catalog
    .from("businesses")
    .select(CATALOG_MERGE_BAGGAGE_SELECT.business)
    .eq("id", input.dropId)
    .maybeSingle();
  if (!keepRow || !dropRow) {
    return fail("Бизнес не найден.");
  }

  const baggage = buildCatalogMergeBaggage({
    keepKind: "business",
    dropKind: "business",
    keep: keepRow as Record<string, unknown>,
    drop: dropRow as Record<string, unknown>,
  });

  // Retarget queue/recs before RPC destroys the donor id.
  await retargetCatalogMergeProvenance(catalog, {
    keepKind: "business",
    keepId: input.keepId,
    dropKind: "business",
    dropId: input.dropId,
  });

  // Extra offices / area before donor row (and its locations) disappear.
  const childFilled = await enrichCatalogMergeChildren(catalog, {
    keepKind: "business",
    keepId: input.keepId,
    dropKind: "business",
    dropId: input.dropId,
    keep: keepRow as Record<string, unknown>,
    drop: dropRow as Record<string, unknown>,
  });

  const { data, error: rpcError } = await supabase.rpc("admin_merge_businesses", {
    p_keep_id: input.keepId,
    p_drop_id: input.dropId,
  });
  if (rpcError) return fail(mapDbError(rpcError));

  // RPC fill-empty is partial (until migration) and always sums mention
  // counters — never re-apply those or we double-count.
  const {
    third_party_mention_count: _omitThird,
    self_ad_mention_count: _omitSelf,
    ...fieldPatch
  } = baggage.patch;
  if (Object.keys(fieldPatch).length > 0) {
    await catalog
      .from("businesses")
      .update({
        ...fieldPatch,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.keepId);
  }
  if (baggage.secondarySourceUrl) {
    await preserveSecondaryMergeSource(catalog, {
      keepKind: "business",
      keepId: input.keepId,
      sourceUrl: baggage.secondarySourceUrl,
      label: baggage.secondarySourceLabel,
      dropId: input.dropId,
    });
  }

  const stats = (data ?? {}) as {
    offers_moved?: number;
    reviews_moved?: number;
    owners_moved?: number;
    mentions_moved?: number;
  };
  const parts = [
    `офферов: ${stats.offers_moved ?? 0}`,
    `отзывов: ${stats.reviews_moved ?? 0}`,
    `владельцев: ${stats.owners_moved ?? 0}`,
    `рекомендаций: ${stats.mentions_moved ?? 0}`,
  ];
  const filledLabels = [...baggage.filled, ...childFilled];
  if (filledLabels.length) {
    parts.push(`полей: ${filledLabels.join(", ")}`);
  }

  revalidateBusinessAdmin(input.keepSlug, input.dropSlug);
  revalidatePath("/search");
  return ok(
    `Смержено. Перенесено — ${parts.join(", ")}. Дубликат уничтожен (не публикуется).`,
  );
}
