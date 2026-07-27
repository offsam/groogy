"use server";

import { revalidatePath } from "next/cache";
import { slugifyJobTitle } from "@/lib/jobs/mappers";
import { userIsAdmin, userOwnsBusiness } from "@/lib/reviews/queries";
import { createServerClient } from "@/lib/supabase/server";

export type JobActionResult =
  | { ok: true; slug: string; id: string }
  | { ok: false; error: string };

function fail(error: string): JobActionResult {
  return { ok: false, error };
}

/** Business posts a vacancy → same row on business page and /jobs. */
export async function createBusinessJobAction(input: {
  businessId: string;
  businessSlug: string;
  title: string;
  description?: string;
  city?: string;
  /** True = no city → visible in every regional hub */
  nationwide?: boolean;
  publish?: boolean;
}): Promise<JobActionResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Войдите в аккаунт.");

  const [owns, isAdmin] = await Promise.all([
    userOwnsBusiness(supabase, input.businessId),
    userIsAdmin(supabase).catch(() => false),
  ]);
  if (!owns && !isAdmin) return fail("Нет прав на этот бизнес.");

  const title = input.title?.trim();
  if (!title || title.length < 2) return fail("Укажите название вакансии.");

  const publish = input.publish !== false;
  const slug = slugifyJobTitle(title);
  const city = input.nationwide
    ? null
    : input.city?.trim().slice(0, 80) || null;

  const { data, error } = await (
    supabase as unknown as {
      from: (t: string) => {
        insert: (row: Record<string, unknown>) => {
          select: (c: string) => {
            single: () => Promise<{
              data: { id: string; slug: string } | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    }
  )
    .from("jobs")
    .insert({
      business_id: input.businessId,
      created_by_profile_id: user.id,
      owner_profile_id: null,
      source_type: "USER",
      title: title.slice(0, 160),
      slug,
      description: input.description?.trim().slice(0, 8000) || null,
      city,
      status: publish ? "published" : "draft",
      visibility: "public",
      offer_kind: "hire",
    })
    .select("id, slug")
    .single();

  if (error || !data) return fail(error?.message ?? "Не удалось создать вакансию.");

  revalidatePath("/jobs");
  revalidatePath(`/jobs/${data.slug}`);
  revalidatePath(`/business/${input.businessSlug}`);
  return { ok: true, id: data.id, slug: data.slug };
}

export async function archiveBusinessJobAction(input: {
  jobId: string;
  businessSlug: string;
}): Promise<JobActionResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Войдите в аккаунт.");

  const { data, error } = await (
    supabase as unknown as {
      from: (t: string) => {
        update: (row: Record<string, unknown>) => {
          eq: (c: string, v: string) => {
            select: (cols: string) => {
              maybeSingle: () => Promise<{
                data: { id: string; slug: string } | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      };
    }
  )
    .from("jobs")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("id", input.jobId)
    .select("id, slug")
    .maybeSingle();

  if (error) return fail(error.message);
  if (!data) return fail("Вакансия не найдена или нет доступа.");

  revalidatePath("/jobs");
  revalidatePath(`/business/${input.businessSlug}`);
  return { ok: true, id: data.id, slug: data.slug };
}
