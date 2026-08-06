"use server";

/**
 * Картотека блогеров — admin-only internal reference list of
 * Russian-speaking bloggers/creators relevant to the US audience
 * (living in the US, or making content about the US), across
 * Facebook / Instagram / YouTube / TikTok / Telegram.
 *
 * Phase 1: just a searchable, category-tagged list kept in the admin.
 * No public-facing UI yet — that comes later once the list is curated.
 */

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { userIsAdmin } from "@/lib/reviews/queries";

export type BloggerDirectoryActionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string };

export type BloggerDirectoryRow = {
  id: string;
  name: string;
  category: string;
  location: string | null;
  notes: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  youtubeUrl: string | null;
  tiktokUrl: string | null;
  telegramUrl: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
};

function fail(message: string): BloggerDirectoryActionResult {
  return { ok: false, message };
}

function ok(message?: string): BloggerDirectoryActionResult {
  return { ok: true, message };
}

async function requireAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { user: null, error: fail("Нужно войти в аккаунт.") };
  }
  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    return { user, error: fail("Только для администраторов.") };
  }
  return { user, error: null };
}

function sanitizeUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (value.length > 2000) return null;
  // Bloggers get pasted from search results without a scheme sometimes.
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function mapRow(row: {
  id: string;
  name: string;
  category: string;
  location: string | null;
  notes: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  youtube_url: string | null;
  tiktok_url: string | null;
  telegram_url: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}): BloggerDirectoryRow {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    location: row.location,
    notes: row.notes,
    facebookUrl: row.facebook_url,
    instagramUrl: row.instagram_url,
    youtubeUrl: row.youtube_url,
    tiktokUrl: row.tiktok_url,
    telegramUrl: row.telegram_url,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listBloggerDirectoryAction(): Promise<
  | { ok: true; bloggers: BloggerDirectoryRow[] }
  | { ok: false; message: string; bloggers: [] }
> {
  const { error } = await requireAdmin();
  if (error) {
    return {
      ok: false,
      message: error.ok === false ? error.message : "Только для администраторов.",
      bloggers: [],
    };
  }

  const catalog = createServiceRoleClient();
  const { data, error: queryError } = await catalog
    .from("blogger_directory")
    .select(
      "id, name, category, location, notes, facebook_url, instagram_url, youtube_url, tiktok_url, telegram_url, source, created_at, updated_at",
    )
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (queryError) {
    return { ok: false, message: "Не удалось загрузить картотеку.", bloggers: [] };
  }

  return { ok: true, bloggers: (data ?? []).map(mapRow) };
}

export type BloggerDirectoryInput = {
  name: string;
  category: string;
  location?: string | null;
  notes?: string | null;
  facebookUrl?: string | null;
  instagramUrl?: string | null;
  youtubeUrl?: string | null;
  tiktokUrl?: string | null;
  telegramUrl?: string | null;
  source?: string | null;
};

function buildInsertPayload(input: BloggerDirectoryInput, userId: string) {
  const name = input.name.trim();
  const category = input.category.trim() || "разное";
  return {
    name,
    category,
    location: input.location?.trim() || null,
    notes: input.notes?.trim() || null,
    facebook_url: sanitizeUrl(input.facebookUrl),
    instagram_url: sanitizeUrl(input.instagramUrl),
    youtube_url: sanitizeUrl(input.youtubeUrl),
    tiktok_url: sanitizeUrl(input.tiktokUrl),
    telegram_url: sanitizeUrl(input.telegramUrl),
    source: input.source?.trim() || null,
    created_by: userId,
  };
}

export async function createBloggerAction(
  input: BloggerDirectoryInput,
): Promise<BloggerDirectoryActionResult> {
  const { user, error } = await requireAdmin();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const name = input.name.trim();
  if (name.length < 2) return fail("Укажите имя/название блогера.");

  const catalog = createServiceRoleClient();
  const { error: insertError } = await catalog
    .from("blogger_directory")
    .insert(buildInsertPayload(input, user.id));

  if (insertError) return fail("Не удалось сохранить запись.");

  revalidatePath("/admin/blogger-directory");
  return ok("Добавлено.");
}

export async function updateBloggerAction(
  input: BloggerDirectoryInput & { id: string },
): Promise<BloggerDirectoryActionResult> {
  const { user, error } = await requireAdmin();
  if (error || !user) return error ?? fail("Нужно войти в аккаунт.");

  const name = input.name.trim();
  if (name.length < 2) return fail("Укажите имя/название блогера.");

  const catalog = createServiceRoleClient();
  const payload = buildInsertPayload(input, user.id);
  const { created_by: _createdBy, ...updatePayload } = payload;
  void _createdBy;

  const { error: updateError } = await catalog
    .from("blogger_directory")
    .update(updatePayload)
    .eq("id", input.id);

  if (updateError) return fail("Не удалось обновить запись.");

  revalidatePath("/admin/blogger-directory");
  return ok("Обновлено.");
}

export async function deleteBloggerAction(input: {
  id: string;
}): Promise<BloggerDirectoryActionResult> {
  const { error } = await requireAdmin();
  if (error) return error;

  const catalog = createServiceRoleClient();
  const { error: deleteError } = await catalog
    .from("blogger_directory")
    .delete()
    .eq("id", input.id);

  if (deleteError) return fail("Не удалось удалить запись.");

  revalidatePath("/admin/blogger-directory");
  return ok("Удалено.");
}
