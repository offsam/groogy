"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { professionalDetailTag } from "@/lib/platform/catalog-cache";
import { normalizeTelegramInput } from "@/lib/business/presence";
import { mergeLocationWithGroupFallback } from "@/lib/geo/source-group-location";
import { slugifyProfessionalName } from "@/lib/professional/mappers";
import {
  canCurrentUserPublish,
  getMyProfessional,
  getOwnedProfessionalBySlug,
  userOwnsProfessional,
} from "@/lib/professional/queries";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import {
  CONTACT_LINKS_COLUMN_READY,
  serializeContactLinks,
  type ContactLink,
} from "@/lib/contacts/channels";
import type { ProfessionalService } from "@/types/professional";

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
  /** Channels without a dedicated column (Facebook, TikTok, WhatsApp, …). */
  contactLinks?: ContactLink[];
  /** Company the person works at (not ownership). */
  employerName?: string;
  employerRole?: string;
  /** Catalog business slug to link, or empty to clear. */
  employerBusinessSlug?: string;
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

async function resolveEmployerFields(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  input: CreateProfessionalInput,
): Promise<{
  employer_name: string | null;
  employer_role: string | null;
  employer_business_id: string | null;
}> {
  const employerName = input.employerName?.trim().slice(0, 160) || null;
  const employerRole = input.employerRole?.trim().slice(0, 120) || null;
  const rawSlug = input.employerBusinessSlug?.trim() || "";
  const businessSlug = rawSlug
    .replace(/^\/+/, "")
    .replace(/^business\//i, "")
    .split("/")
    .filter(Boolean)[0]
    ?.trim();

  let employerBusinessId: string | null = null;
  let linkedName: string | null = null;
  if (businessSlug) {
    const { data } = await supabase
      .from("businesses")
      .select("id, name")
      .eq("slug", businessSlug)
      .eq("status", "approved")
      .maybeSingle();
    if (data?.id) {
      employerBusinessId = data.id;
      linkedName = (data.name as string)?.trim() || null;
    }
  }

  return {
    employer_name: employerName || linkedName,
    employer_role: employerRole,
    employer_business_id: employerBusinessId,
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
  const employer = await resolveEmployerFields(supabase, input);

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
      ...(CONTACT_LINKS_COLUMN_READY
        ? { contact_links: serializeContactLinks(input.contactLinks ?? []) }
        : {}),
      ...employer,
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
  revalidateTag(professionalDetailTag(data.slug));
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

  const employer = await resolveEmployerFields(supabase, input);

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
    ...(CONTACT_LINKS_COLUMN_READY
      ? { contact_links: serializeContactLinks(input.contactLinks ?? []) }
      : {}),
    ...employer,
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

  const existing = await getOwnedProfessionalBySlug(supabase, slug).catch(
    () => null,
  );
  if (!existing) return fail("Профиль не найден или нет доступа.");

  const canEdit =
    (await userOwnsProfessional(supabase, existing.id).catch(() => false)) ||
    (await userIsAdmin(supabase).catch(() => false));
  if (!canEdit) return fail("Профиль не найден или нет доступа.");

  const { data, error } = await (supabase as unknown as {
    from: (t: string) => {
      update: (row: Record<string, unknown>) => {
        eq: (col: string, val: string) => {
          select: (cols: string) => {
            maybeSingle: () => Promise<{
              data: { slug: string } | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };
  })
    .from("professionals")
    .update(patch)
    .eq("id", existing.id)
    .select("slug")
    .maybeSingle();

  if (error) return fail(error.message);
  if (!data) return fail("Профиль не найден или нет доступа.");

  revalidatePath("/professionals");
  revalidatePath(`/professional/${data.slug}`);
  revalidateTag(professionalDetailTag(data.slug));
  return { ok: true, slug: data.slug };
}

export type AddProfessionalServiceResult =
  | { ok: true }
  | { ok: false; error: string };

export async function addProfessionalServiceAction(input: {
  professionalId: string;
  slug: string;
  title: string;
  description?: string;
  priceMode?: ProfessionalService["priceMode"];
  priceAmount?: number | null;
}): Promise<AddProfessionalServiceResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Войдите в аккаунт." };

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Укажите название услуги." };

  const owns = await userOwnsProfessional(supabase, input.professionalId).catch(
    () => false,
  );
  const isAdmin = await userIsAdmin(supabase).catch(() => false);
  if (!owns && !isAdmin) {
    return { ok: false, error: "Нет доступа." };
  }

  const priceMode = input.priceMode ?? "contact";
  const priceAmount =
    priceMode === "fixed" || priceMode === "from"
      ? input.priceAmount ?? null
      : null;

  const { error } = await (
    supabase as unknown as {
      from: (t: string) => {
        insert: (row: Record<string, unknown>) => Promise<{
          error: { message: string } | null;
        }>;
      };
    }
  )
    .from("professional_services")
    .insert({
      professional_id: input.professionalId,
      title: title.slice(0, 160),
      description: input.description?.trim().slice(0, 2000) || null,
      price_mode: priceMode,
      price_amount: priceAmount,
      currency: "USD",
      is_active: true,
      sort_order: 0,
    });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/professional/${input.slug}`);
  revalidatePath("/professionals");
  return { ok: true };
}
