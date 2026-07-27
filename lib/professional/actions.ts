"use server";

import { revalidatePath } from "next/cache";
import { normalizeTelegramInput } from "@/lib/business/presence";
import { mergeLocationWithGroupFallback } from "@/lib/geo/source-group-location";
import { slugifyProfessionalName } from "@/lib/professional/mappers";
import {
  canCurrentUserPublish,
  getMyProfessional,
} from "@/lib/professional/queries";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export type CreateProfessionalInput = {
  displayName: string;
  headline?: string;
  shortDescription?: string;
  description?: string;
  city?: string;
  region?: string;
  phone?: string;
  email?: string;
  website?: string;
  instagramUrl?: string;
  telegramUrl?: string;
  publish?: boolean;
};

export type ProfessionalActionResult =
  | { ok: true; slug: string }
  | { ok: false; error: string };

function fail(message: string): ProfessionalActionResult {
  return { ok: false, error: message };
}

/** City/county for profile + filters; no invented map pin without a street. */
function professionalLocationFields(input: {
  city?: string;
  region?: string;
}) {
  const loc = mergeLocationWithGroupFallback({
    city: input.city,
    region: input.region,
  });
  const location_precision =
    loc.region && !loc.city ? "county" : loc.city ? "city" : null;
  return {
    city: loc.city,
    region: loc.region,
    state_code: loc.stateCode,
    location_precision,
    // Area-only profiles stay off the map.
    latitude: null,
    longitude: null,
    public_exact_address: false,
  };
}

export async function createProfessionalAction(
  input: CreateProfessionalInput,
): Promise<ProfessionalActionResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Войдите в аккаунт.");

  const existing = await getMyProfessional(supabase, user.id).catch(() => null);
  if (existing) {
    return fail("У вас уже есть профиль специалиста.");
  }

  const isAdmin = await userIsAdmin(supabase).catch(() => false);
  const canPublish = isAdmin || (await canCurrentUserPublish(supabase));
  const publish = Boolean(input.publish);

  if (publish && !canPublish) {
    return fail(
      "Чтобы опубликовать, подтвердите email и заполните имя + ZIP в профиле. Можно сохранить черновик.",
    );
  }

  if (!isAdmin && !canPublish) {
    // Draft path: still need a real profile row with name+ZIP (RLS is_profile_completed)
    const { data: completed } = await (
      supabase as unknown as {
        rpc: (n: string, a: { p_profile_id: string }) => Promise<{ data: boolean }>;
      }
    ).rpc("is_profile_completed", { p_profile_id: user.id });
    if (!completed) {
      return fail("Заполните имя и ZIP в настройках профиля, затем создайте карточку.");
    }
  }

  const displayName = input.displayName?.trim();
  if (!displayName || displayName.length < 2) {
    return fail("Укажите имя или название.");
  }

  const slug = slugifyProfessionalName(displayName);
  const status = publish && canPublish ? "approved" : "draft";

  const { data, error } = await (supabase as unknown as {
    from: (t: string) => {
      insert: (row: Record<string, unknown>) => {
        select: (cols: string) => {
          single: () => Promise<{
            data: { slug: string } | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  })
    .from("professionals")
    .insert({
      owner_profile_id: user.id,
      created_by_profile_id: user.id,
      source_type: "USER",
      display_name: displayName.slice(0, 120),
      slug,
      headline: input.headline?.trim().slice(0, 160) || null,
      short_description: input.shortDescription?.trim().slice(0, 280) || null,
      description: input.description?.trim().slice(0, 8000) || null,
      ...professionalLocationFields(input),
      phone: input.phone?.trim().slice(0, 40) || null,
      email: input.email?.trim().slice(0, 120) || null,
      website: input.website?.trim().slice(0, 200) || null,
      instagram_url: input.instagramUrl?.trim().slice(0, 200) || null,
      telegram_url: normalizeTelegramInput(input.telegramUrl)?.slice(0, 200) || null,
      status,
      visibility: "public",
      languages: ["ru"],
    })
    .select("slug")
    .single();

  if (error || !data) {
    return fail(error?.message ?? "Не удалось создать профиль.");
  }

  revalidatePath("/professionals");
  revalidatePath(`/professional/${data.slug}`);
  return { ok: true, slug: data.slug };
}

export async function updateProfessionalAction(
  slug: string,
  input: CreateProfessionalInput,
): Promise<ProfessionalActionResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Войдите в аккаунт.");

  const displayName = input.displayName?.trim();
  if (!displayName || displayName.length < 2) {
    return fail("Укажите имя или название.");
  }

  const patch: Record<string, unknown> = {
    display_name: displayName.slice(0, 120),
    headline: input.headline?.trim().slice(0, 160) || null,
    short_description: input.shortDescription?.trim().slice(0, 280) || null,
    description: input.description?.trim().slice(0, 8000) || null,
    ...professionalLocationFields(input),
    phone: input.phone?.trim().slice(0, 40) || null,
    email: input.email?.trim().slice(0, 120) || null,
    website: input.website?.trim().slice(0, 200) || null,
    instagram_url: input.instagramUrl?.trim().slice(0, 200) || null,
    telegram_url: normalizeTelegramInput(input.telegramUrl)?.slice(0, 200) || null,
  };

  if (input.publish) {
    const canPublish =
      (await userIsAdmin(supabase).catch(() => false)) ||
      (await canCurrentUserPublish(supabase));
    if (!canPublish) {
      return fail(
        "Чтобы опубликовать, подтвердите email и заполните имя + ZIP в профиле.",
      );
    }
    patch.status = "approved";
  }

  const { data, error } = await (supabase as unknown as {
    from: (t: string) => {
      update: (row: Record<string, unknown>) => {
        eq: (col: string, val: string) => {
          eq: (col2: string, val2: string) => {
            select: (cols: string) => {
              maybeSingle: () => Promise<{
                data: { slug: string } | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      };
    };
  })
    .from("professionals")
    .update(patch)
    .eq("slug", slug)
    .eq("owner_profile_id", user.id)
    .select("slug")
    .maybeSingle();

  if (error) return fail(error.message);
  if (!data) return fail("Профиль не найден или нет доступа.");

  revalidatePath("/professionals");
  revalidatePath(`/professional/${data.slug}`);
  return { ok: true, slug: data.slug };
}
