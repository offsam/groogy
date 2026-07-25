"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { updateProfileDisplayName } from "@/lib/supabase/queries";
import { authMessage, mapAuthError, type AuthMessageCode } from "@/lib/auth/messages";

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string; code?: AuthMessageCode };

export async function signOutAction() {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function updateDisplayNameAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const displayName = String(formData.get("display_name") ?? "").trim();

  if (!displayName) {
    return { ok: false, message: "Укажите имя." };
  }

  if (displayName.length > 80) {
    return { ok: false, message: "Имя слишком длинное (максимум 80 символов)." };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, message: "Нужно войти в аккаунт." };
  }

  try {
    await updateProfileDisplayName(supabase, user.id, displayName);
    revalidatePath("/profile");
    revalidatePath("/", "layout");
    return { ok: true, message: authMessage("profile_updated") };
  } catch (error) {
    const code = mapAuthError(error as { message?: string });
    return { ok: false, message: authMessage(code), code };
  }
}

export async function updatePasswordAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");

  if (password.length < 6) {
    return { ok: false, message: authMessage("weak_password"), code: "weak_password" };
  }

  if (password !== confirm) {
    return { ok: false, message: "Пароли не совпадают." };
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    const code = mapAuthError(error);
    return { ok: false, message: authMessage(code), code };
  }

  return { ok: true, message: authMessage("password_updated") };
}
