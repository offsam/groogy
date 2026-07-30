"use server";

/**
 * Professional category action.
 * Section moves live in @/lib/admin/move-entity-section (moveEntitySectionAction).
 */

import { createServiceRoleClient } from "@/lib/supabase/service";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import { revalidatePath } from "next/cache";

export async function adminSetProfessionalCategoryAction(input: {
  professionalId: string;
  categoryId: string | null;
  slug?: string | null;
}): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Нужно войти в аккаунт." };
  if (!(await userIsAdmin(supabase))) {
    return { ok: false, message: "Только для администраторов." };
  }

  const catalog = createServiceRoleClient();
  if (input.categoryId) {
    const { data: cat, error: catError } = await catalog
      .from("categories")
      .select("id")
      .eq("id", input.categoryId)
      .eq("is_active", true)
      .maybeSingle();
    if (catError) return { ok: false, message: catError.message };
    if (!cat) {
      return { ok: false, message: "Категория не найдена или неактивна." };
    }
  }

  const { error: updateError } = await (
    catalog as unknown as {
      from: (t: string) => {
        update: (row: Record<string, unknown>) => {
          eq: (
            c: string,
            v: string,
          ) => Promise<{ error: { message: string } | null }>;
        };
      };
    }
  )
    .from("professionals")
    .update({
      category_id: input.categoryId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.professionalId);

  if (updateError) return { ok: false, message: updateError.message };

  revalidatePath("/professionals");
  if (input.slug) revalidatePath(`/professional/${input.slug}`);
  return { ok: true, message: "Категория обновлена." };
}
