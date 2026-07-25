"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import {
  BUSINESS_COVER_MAX_UPLOAD_BYTES,
  BUSINESS_IMAGES_BUCKET,
  businessCoverPathFromPublicUrl,
  businessCoverStoragePrefix,
  optimizeBusinessCover,
} from "@/lib/business/optimize-image.server";
import { userIsAdmin, userOwnsBusiness } from "@/lib/reviews/queries";

export type CoverUploadResult =
  | { ok: true; message?: string; imageUrl?: string }
  | { ok: false; message: string };

function fail(message: string): CoverUploadResult {
  return { ok: false, message };
}

async function requireBusinessEditor(businessId: string) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, user: null, error: fail("Нужно войти в аккаунт.") };
  }
  const [owns, isAdmin] = await Promise.all([
    userOwnsBusiness(supabase, businessId),
    userIsAdmin(supabase).catch(() => false),
  ]);
  if (!owns && !isAdmin) {
    return { supabase, user, error: fail("Нет прав на редактирование.") };
  }
  return { supabase, user, error: null as null };
}

export async function uploadBusinessCoverAction(input: {
  businessId: string;
  businessSlug: string;
  formData: FormData;
}): Promise<CoverUploadResult> {
  const { supabase, error } = await requireBusinessEditor(input.businessId);
  if (error) return error;

  const file = input.formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return fail("Выберите файл.");
  }
  if (!file.type.startsWith("image/")) {
    return fail("Допустимы только изображения.");
  }
  if (file.size > BUSINESS_COVER_MAX_UPLOAD_BYTES) {
    return fail("Файл слишком большой после сжатия (макс. 12 МБ).");
  }

  let optimized;
  try {
    const raw = Buffer.from(await file.arrayBuffer());
    optimized = await optimizeBusinessCover(raw);
  } catch {
    return fail("Не удалось обработать изображение.");
  }

  const filename = `${crypto.randomUUID()}.webp`;
  const storagePath = `${businessCoverStoragePrefix(input.businessId)}${filename}`;

  const { data: existing } = await supabase
    .from("businesses")
    .select("image_url")
    .eq("id", input.businessId)
    .maybeSingle();

  const { error: uploadError } = await supabase.storage
    .from(BUSINESS_IMAGES_BUCKET)
    .upload(storagePath, optimized.buffer, {
      contentType: optimized.contentType,
      upsert: false,
      cacheControl: "31536000",
    });

  if (uploadError) {
    return fail(uploadError.message || "Не удалось загрузить файл.");
  }

  const { data: publicData } = supabase.storage
    .from(BUSINESS_IMAGES_BUCKET)
    .getPublicUrl(storagePath);
  const imageUrl = publicData.publicUrl;

  const { error: updateError } = await supabase
    .from("businesses")
    .update({ image_url: imageUrl })
    .eq("id", input.businessId);

  if (updateError) {
    await supabase.storage.from(BUSINESS_IMAGES_BUCKET).remove([storagePath]);
    return fail(updateError.message || "Не удалось сохранить фото.");
  }

  const oldPath = businessCoverPathFromPublicUrl(existing?.image_url);
  if (oldPath && oldPath !== storagePath) {
    void supabase.storage.from(BUSINESS_IMAGES_BUCKET).remove([oldPath]);
  }

  revalidatePath(`/business/${input.businessSlug}`);
  revalidatePath(`/business/${input.businessSlug}/manage`);
  revalidatePath("/");
  return { ok: true, message: "Фото обновлено.", imageUrl };
}
