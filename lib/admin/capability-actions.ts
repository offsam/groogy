"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import { isAdminCapabilityId } from "@/lib/admin/capabilities";

export type AdminCapabilitySaveResult =
  | { ok: true }
  | { ok: false; message: string };

export async function saveAdminCapabilitiesAction(input: {
  userId: string;
  capabilities: string[];
}): Promise<AdminCapabilitySaveResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await userIsAdmin(supabase))) {
    return { ok: false, message: "Только для администраторов." };
  }
  if (!input.userId) {
    return { ok: false, message: "Не выбран администратор." };
  }

  const capabilities = [...new Set(input.capabilities.filter(isAdminCapabilityId))];
  if (capabilities.length === 0) {
    return { ok: false, message: "Оставьте хотя бы один раздел." };
  }

  const { error } = await (supabase as SupabaseClient)
    .from("admin_capability_grants")
    .upsert(
      {
        user_id: input.userId,
        capabilities,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  if (error) {
    return {
      ok: false,
      message: "Не удалось сохранить права.",
    };
  }

  revalidatePath("/admin/people");
  return { ok: true };
}
