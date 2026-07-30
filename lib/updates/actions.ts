"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import type { UpdateOwnerType } from "@/types/update";

type FollowResult = { ok: true; message: string } | { ok: false; message: string };

function fail(message: string): FollowResult {
  return { ok: false, message };
}

function ok(message: string): FollowResult {
  return { ok: true, message };
}

type LooseClient = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => Promise<{
      error: { code?: string; message: string } | null;
    }>;
    delete: () => {
      eq: (a: string, b: string) => {
        eq: (a: string, b: string) => {
          eq: (
            a: string,
            b: string,
          ) => Promise<{ error: { message: string } | null }>;
        };
      };
    };
  };
};

async function requireUser() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return {
      supabase,
      user: null as null,
      error: fail("Нужно войти в аккаунт."),
    };
  return { supabase, user, error: null as null };
}

export async function followEntityAction(input: {
  ownerType: UpdateOwnerType;
  ownerId: string;
  revalidate?: string;
}): Promise<FollowResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const { error: insertError } = await (supabase as unknown as LooseClient)
    .from("entity_follows")
    .insert({
      user_id: user.id,
      owner_type: input.ownerType,
      owner_id: input.ownerId,
    });

  if (insertError) {
    if (insertError.code === "23505") {
      return ok("Уже подписаны.");
    }
    return fail(insertError.message || "Не удалось подписаться.");
  }

  if (input.revalidate) revalidatePath(input.revalidate);
  revalidatePath("/updates/mine");
  return ok("Подписка оформлена.");
}

export async function unfollowEntityAction(input: {
  ownerType: UpdateOwnerType;
  ownerId: string;
  revalidate?: string;
}): Promise<FollowResult> {
  const { supabase, user, error } = await requireUser();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const { error: deleteError } = await (supabase as unknown as LooseClient)
    .from("entity_follows")
    .delete()
    .eq("user_id", user.id)
    .eq("owner_type", input.ownerType)
    .eq("owner_id", input.ownerId);

  if (deleteError) {
    return fail(deleteError.message || "Не удалось отписаться.");
  }

  if (input.revalidate) revalidatePath(input.revalidate);
  revalidatePath("/updates/mine");
  return ok("Подписка снята.");
}
