"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import {
  normalizeOfferInput,
  offerToDbRow,
  validateOfferInput,
  type OfferFormInput,
} from "@/lib/business-offers/validation";
import { offerStoragePrefix, MAX_OFFER_MEDIA } from "@/lib/business-offers/media";
import { LISTING_IMAGES_BUCKET } from "@/lib/listings/constants";
import type { Database } from "@/types/database";
import type { BusinessOfferStatus } from "@/types/business-offer";

export type OfferActionResult =
  | { ok: true; message?: string; offerId?: string }
  | { ok: false; message: string };

function fail(message: string): OfferActionResult {
  return { ok: false, message };
}

function ok(message?: string, extra?: { offerId?: string }): OfferActionResult {
  return { ok: true, message, ...extra };
}

function mapDbError(error: { message?: string } | null): string {
  const message = (error?.message ?? "").toLowerCase();
  if (message.includes("not business owner")) {
    return "Вы не владелец этого бизнеса.";
  }
  if (message.includes("invalid attribute")) {
    return "Недопустимое поле для выбранного типа предложения.";
  }
  if (message.includes("duplicate key") || message.includes("business_offers_business_id_slug")) {
    return "Предложение с таким slug уже существует.";
  }
  if (message.includes("maximum 10 images")) {
    return "Максимум 10 изображений на предложение.";
  }
  return error?.message ?? "Не удалось сохранить предложение.";
}

async function requireOwner(businessId: string) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, error: "Войдите в аккаунт." as const };

  const { data: owns, error } = await supabase.rpc("owns_business", {
    p_business_id: businessId,
  });
  if (error) return { supabase, error: error.message };
  if (!owns) return { supabase, error: "Вы не владелец этого бизнеса." as const };

  const { data: admin } = await supabase.rpc("is_admin");
  return { supabase, user, isAdmin: admin === true };
}

function revalidateBusinessPaths(businessSlug: string, offerSlug?: string) {
  revalidatePath(`/business/${businessSlug}`);
  revalidatePath(`/business/${businessSlug}/manage`);
  revalidatePath(`/business/${businessSlug}/manage/offers`);
  if (offerSlug) {
    revalidatePath(`/business/${businessSlug}/offers/${offerSlug}`);
    revalidatePath(`/businesses/${businessSlug}/offers/${offerSlug}`);
  }
}

export async function createBusinessOfferAction(
  input: OfferFormInput,
  businessSlug: string,
): Promise<OfferActionResult> {
  const validationError = validateOfferInput(normalizeOfferInput(input));
  if (validationError) return fail(validationError);

  const auth = await requireOwner(input.businessId);
  if ("error" in auth && typeof auth.error === "string") return fail(auth.error);

  const row = offerToDbRow(input);
  const { data, error } = await auth.supabase
    .from("business_offers")
    .insert(row)
    .select("id")
    .single();

  if (error) return fail(mapDbError(error));
  revalidateBusinessPaths(businessSlug);
  return ok("Предложение создано.", { offerId: data.id });
}

export async function updateBusinessOfferAction(
  offerId: string,
  input: OfferFormInput,
  businessSlug: string,
): Promise<OfferActionResult> {
  const validationError = validateOfferInput(normalizeOfferInput(input));
  if (validationError) return fail(validationError);

  const auth = await requireOwner(input.businessId);
  if ("error" in auth && typeof auth.error === "string") return fail(auth.error);

  const row = offerToDbRow(input);
  const { business_id, ...updateRow } = row;
  void business_id;

  const { error } = await auth.supabase
    .from("business_offers")
    .update(updateRow)
    .eq("id", offerId)
    .eq("business_id", input.businessId);

  if (error) return fail(mapDbError(error));
  revalidateBusinessPaths(businessSlug, input.slug);
  return ok("Предложение обновлено.", { offerId });
}

export async function setBusinessOfferStatusAction(
  offerId: string,
  businessId: string,
  businessSlug: string,
  status: BusinessOfferStatus,
  offerSlug?: string,
): Promise<OfferActionResult> {
  const auth = await requireOwner(businessId);
  if ("error" in auth && typeof auth.error === "string") return fail(auth.error);

  const patch: Database["public"]["Tables"]["business_offers"]["Update"] = {
    status,
  };

  const { error } = await auth.supabase
    .from("business_offers")
    .update(patch)
    .eq("id", offerId)
    .eq("business_id", businessId);

  if (error) return fail(mapDbError(error));
  revalidateBusinessPaths(businessSlug, offerSlug);
  return ok(status === "active" ? "Опубликовано." : "Статус обновлён.");
}

export async function deleteBusinessOfferAction(
  offerId: string,
  businessId: string,
  businessSlug: string,
): Promise<OfferActionResult> {
  const auth = await requireOwner(businessId);
  if ("error" in auth && typeof auth.error === "string") return fail(auth.error);

  const { error } = await auth.supabase
    .from("business_offers")
    .delete()
    .eq("id", offerId)
    .eq("business_id", businessId);

  if (error) return fail(mapDbError(error));
  revalidateBusinessPaths(businessSlug);
  return ok("Предложение удалено.");
}

export async function reorderBusinessOffersAction(
  businessId: string,
  businessSlug: string,
  orderedIds: string[],
): Promise<OfferActionResult> {
  const auth = await requireOwner(businessId);
  if ("error" in auth && typeof auth.error === "string") return fail(auth.error);

  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await auth.supabase
      .from("business_offers")
      .update({ sort_order: i })
      .eq("id", orderedIds[i]!)
      .eq("business_id", businessId);
    if (error) return fail(mapDbError(error));
  }

  revalidateBusinessPaths(businessSlug);
  return ok("Порядок сохранён.");
}

export async function uploadOfferImageAction(
  offerId: string,
  businessId: string,
  businessSlug: string,
  formData: FormData,
): Promise<OfferActionResult & { publicUrl?: string }> {
  const auth = await requireOwner(businessId);
  if ("error" in auth && typeof auth.error === "string") return fail(auth.error);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return fail("Выберите файл.");
  }
  if (!file.type.startsWith("image/")) {
    return fail("Допустимы только изображения.");
  }
  if (file.size > 5 * 1024 * 1024) {
    return fail("Файл больше 5 МБ.");
  }

  const { count, error: countError } = await auth.supabase
    .from("business_offer_media")
    .select("id", { count: "exact", head: true })
    .eq("offer_id", offerId);

  if (countError) return fail(countError.message);
  if ((count ?? 0) >= MAX_OFFER_MEDIA) {
    return fail("Максимум 10 изображений.");
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const safeExt = ["jpg", "jpeg", "png", "webp", "gif"].includes(ext) ? ext : "jpg";
  const filename = `${crypto.randomUUID()}.${safeExt}`;
  const storagePath = `${offerStoragePrefix(businessId, offerId)}${filename}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await auth.supabase.storage
    .from(LISTING_IMAGES_BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) return fail(uploadError.message);

  const sortOrder = count ?? 0;
  const { error: mediaError } = await auth.supabase.from("business_offer_media").insert({
    offer_id: offerId,
    storage_path: storagePath,
    sort_order: sortOrder,
    alt_text: formData.get("altText")?.toString() || null,
  });

  if (mediaError) return fail(mapDbError(mediaError));

  revalidateBusinessPaths(businessSlug);
  return ok("Изображение загружено.");
}

export async function deleteOfferImageAction(
  mediaId: string,
  offerId: string,
  businessId: string,
  businessSlug: string,
): Promise<OfferActionResult> {
  const auth = await requireOwner(businessId);
  if ("error" in auth && typeof auth.error === "string") return fail(auth.error);

  const { data: media, error: fetchError } = await auth.supabase
    .from("business_offer_media")
    .select("storage_path")
    .eq("id", mediaId)
    .eq("offer_id", offerId)
    .maybeSingle();

  if (fetchError) return fail(fetchError.message);
  if (!media) return fail("Изображение не найдено.");

  const { error: delRow } = await auth.supabase
    .from("business_offer_media")
    .delete()
    .eq("id", mediaId);

  if (delRow) return fail(mapDbError(delRow));

  await auth.supabase.storage
    .from(LISTING_IMAGES_BUCKET)
    .remove([media.storage_path]);

  revalidateBusinessPaths(businessSlug);
  return ok("Изображение удалено.");
}
