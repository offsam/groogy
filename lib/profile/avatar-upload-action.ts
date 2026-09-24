"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { tryCreateServiceRoleClient } from "@/lib/supabase/service";
import {
  PROFILE_AVATARS_BUCKET,
  PROFILE_AVATAR_MAX_UPLOAD_BYTES,
  optimizeProfileAvatar,
  profileAvatarPathFromPublicUrl,
  profileAvatarStoragePrefix,
} from "@/lib/profile/optimize-avatar.server";

export type AvatarUploadResult =
  | { ok: true; message?: string; avatarUrl?: string }
  | { ok: false; message: string };

function fail(message: string): AvatarUploadResult {
  return { ok: false, message };
}

async function ensureProfileAvatarsBucket(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  storage: { from: (id: string) => unknown; createBucket: Function; getBucket: Function },
) {
  const { data: existing } = await storage.getBucket(PROFILE_AVATARS_BUCKET);
  if (existing) return;

  const { error } = await storage.createBucket(PROFILE_AVATARS_BUCKET, {
    public: true,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  });
  // Race: another request may have created it.
  if (error && !/already exists|duplicate/i.test(error.message)) {
    throw new Error(error.message);
  }
}

export async function uploadProfileAvatarAction(
  formData: FormData,
): Promise<AvatarUploadResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Нужно войти в аккаунт.");

  const catalog = tryCreateServiceRoleClient();
  if (!catalog) {
    return fail("Серверное хранилище не настроено (нет service role).");
  }

  const raw = formData.get("file");
  let file: File | null = null;
  if (raw instanceof File) {
    file = raw;
  } else if (typeof raw !== "string" && raw && typeof Blob !== "undefined") {
    const maybeBlob = raw as Blob;
    if (typeof maybeBlob.arrayBuffer === "function" && maybeBlob.size > 0) {
      file = new File([maybeBlob], "avatar.webp", {
        type: maybeBlob.type || "image/webp",
      });
    }
  }
  if (!file || file.size === 0) {
    return fail("Выберите файл.");
  }
  const looksLikeImage =
    file.type.startsWith("image/") ||
    file.type === "" ||
    /\.(jpe?g|png|webp|gif)$/i.test(file.name);
  if (!looksLikeImage) {
    return fail("Допустимы только изображения.");
  }
  if (file.size > PROFILE_AVATAR_MAX_UPLOAD_BYTES) {
    return fail("Файл слишком большой (макс. 8 МБ).");
  }

  let optimized;
  try {
    optimized = await optimizeProfileAvatar(
      Buffer.from(await file.arrayBuffer()),
    );
  } catch {
    return fail("Не удалось обработать изображение.");
  }

  const { data: existing } = await supabase
    .from("profiles")
    .select("avatar_url, username")
    .eq("id", user.id)
    .maybeSingle();

  try {
    await ensureProfileAvatarsBucket(catalog.storage);
  } catch (err) {
    return fail(
      err instanceof Error
        ? err.message
        : "Не удалось создать хранилище для фото.",
    );
  }

  const storagePath = `${profileAvatarStoragePrefix(user.id)}${crypto.randomUUID()}.webp`;
  const { error: uploadError } = await catalog.storage
    .from(PROFILE_AVATARS_BUCKET)
    .upload(storagePath, optimized.buffer, {
      contentType: optimized.contentType,
      upsert: false,
    });
  if (uploadError) {
    return fail(uploadError.message || "Не удалось загрузить файл.");
  }

  const { data: publicUrlData } = catalog.storage
    .from(PROFILE_AVATARS_BUCKET)
    .getPublicUrl(storagePath);
  const avatarUrl = publicUrlData.publicUrl;

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("id", user.id);

  if (updateError) {
    await catalog.storage.from(PROFILE_AVATARS_BUCKET).remove([storagePath]);
    return fail(updateError.message || "Не удалось сохранить аватар.");
  }

  const oldPath = profileAvatarPathFromPublicUrl(existing?.avatar_url);
  if (oldPath && oldPath.startsWith(`avatars/${user.id}/`)) {
    void catalog.storage.from(PROFILE_AVATARS_BUCKET).remove([oldPath]);
  }

  revalidatePath("/profile");
  revalidatePath("/me/settings");
  if (existing?.username) {
    revalidatePath(`/u/${existing.username}`);
  }

  return { ok: true, message: "Фото обновлено.", avatarUrl };
}
