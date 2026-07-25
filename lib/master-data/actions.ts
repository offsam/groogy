"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { MASTER_DATA_TAG, searchCities } from "@/lib/master-data/queries";
import { userIsAdmin } from "@/lib/reviews/queries";
import type { CitySearchResult, MasterDataDomain } from "@/types/master-data";
import type { ListingDomain, ListingType } from "@/types/listing";

export type MasterDataActionResult =
  | { ok: true; message?: string; id?: string }
  | { ok: false; message: string };

function fail(message: string): MasterDataActionResult {
  return { ok: false, message };
}

function ok(message?: string, id?: string): MasterDataActionResult {
  return { ok: true, message, id };
}

function mapDbError(error: { message?: string } | null): string {
  const message = (error?.message ?? "").toLowerCase();
  if (message.includes("admin only")) {
    return "Только для администраторов.";
  }
  if (message.includes("not found")) {
    return "Запись не найдена.";
  }
  if (message.includes("required")) {
    return "Заполните обязательные поля.";
  }
  if (message.includes("duplicate") || message.includes("unique")) {
    return "Такая запись уже существует.";
  }
  return error?.message || "Не удалось выполнить действие.";
}

async function requireAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, error: fail("Нужно войти в аккаунт.") as MasterDataActionResult };
  }
  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    return { supabase, error: fail("Только для администраторов.") as MasterDataActionResult };
  }
  return { supabase, error: null };
}

function revalidateMasterData() {
  revalidateTag(MASTER_DATA_TAG);
  revalidatePath("/admin/master-data");
  revalidatePath("/marketplace/new");
  revalidatePath("/services/new");
}

export async function searchCitiesAction(
  query: string,
  stateCode?: string | null,
): Promise<{ ok: true; cities: CitySearchResult[] } | { ok: false; message: string }> {
  try {
    const cities = await searchCities(query, stateCode);
    return { ok: true, cities };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Ошибка поиска городов",
    };
  }
}

export type UpsertListingCategoryInput = {
  id?: string | null;
  slug?: string | null;
  nameRu?: string | null;
  nameEn?: string | null;
  parentId?: string | null;
  listingType?: ListingType | null;
  domain?: ListingDomain | null;
  sortOrder?: number | null;
  isActive?: boolean | null;
  iconKey?: string | null;
  description?: string | null;
  isSelectable?: boolean | null;
  disclaimerText?: string | null;
};

export async function adminUpsertListingCategoryAction(
  input: UpsertListingCategoryInput,
): Promise<MasterDataActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { data, error: rpcError } = await supabase.rpc(
    "admin_upsert_listing_category",
    {
      p_id: input.id ?? null,
      p_slug: input.slug ?? null,
      p_name_ru: input.nameRu ?? null,
      p_name_en: input.nameEn ?? null,
      p_parent_id: input.parentId ?? null,
      p_listing_type: input.listingType ?? null,
      p_domain: input.domain ?? null,
      p_sort_order: input.sortOrder ?? null,
      p_is_active: input.isActive ?? null,
      p_icon_key: input.iconKey ?? null,
      p_description: input.description ?? null,
      p_is_selectable: input.isSelectable ?? null,
      p_disclaimer_text: input.disclaimerText ?? null,
    },
  );

  if (rpcError) return fail(mapDbError(rpcError));
  revalidateMasterData();
  return ok("Категория сохранена.", data ?? undefined);
}

export async function adminSetListingCategoryActiveAction(
  id: string,
  isActive: boolean,
): Promise<MasterDataActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { error: rpcError } = await supabase.rpc(
    "admin_set_listing_category_active",
    { p_id: id, p_is_active: isActive },
  );
  if (rpcError) return fail(mapDbError(rpcError));
  revalidateMasterData();
  return ok(isActive ? "Категория включена." : "Категория отключена.");
}

export type UpsertFeatureInput = {
  id?: string | null;
  code?: string | null;
  domains?: MasterDataDomain[] | null;
  nameEn?: string | null;
  nameRu?: string | null;
  description?: string | null;
  isActive?: boolean | null;
  sortOrder?: number | null;
  verificationStatusSupported?: boolean | null;
};

export async function adminUpsertFeatureAction(
  input: UpsertFeatureInput,
): Promise<MasterDataActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { data, error: rpcError } = await supabase.rpc("admin_upsert_feature", {
    p_id: input.id ?? null,
    p_code: input.code ?? null,
    p_domains: input.domains ?? null,
    p_name_en: input.nameEn ?? null,
    p_name_ru: input.nameRu ?? null,
    p_description: input.description ?? null,
    p_is_active: input.isActive ?? null,
    p_sort_order: input.sortOrder ?? null,
    p_verification_status_supported: input.verificationStatusSupported ?? null,
  });

  if (rpcError) return fail(mapDbError(rpcError));
  revalidateMasterData();
  return ok("Фича сохранена.", data ?? undefined);
}

export async function adminSetLanguageActiveAction(
  code: string,
  isActive: boolean,
): Promise<MasterDataActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { error: rpcError } = await supabase.rpc("admin_set_language_active", {
    p_code: code,
    p_is_active: isActive,
  });
  if (rpcError) return fail(mapDbError(rpcError));
  revalidateMasterData();
  return ok(isActive ? "Язык включён." : "Язык отключён.");
}

export async function adminSetLanguageSortAction(
  code: string,
  sortOrder: number,
): Promise<MasterDataActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { error: rpcError } = await supabase.rpc("admin_set_language_sort", {
    p_code: code,
    p_sort_order: sortOrder,
  });
  if (rpcError) return fail(mapDbError(rpcError));
  revalidateMasterData();
  return ok("Порядок обновлён.");
}

export async function adminSetLocationActiveAction(
  kind: "state" | "subdivision" | "county" | "city",
  id: string,
  isActive: boolean,
): Promise<MasterDataActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { error: rpcError } = await supabase.rpc("admin_set_location_active", {
    p_kind: kind,
    p_id: id,
    p_is_active: isActive,
  });
  if (rpcError) return fail(mapDbError(rpcError));
  revalidateMasterData();
  return ok(isActive ? "Локация включена." : "Локация отключена.");
}
