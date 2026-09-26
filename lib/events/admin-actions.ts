"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redactContactsFromPublicText } from "@/lib/content/structure-business-profile";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import { isEventPast } from "@/lib/events/timing";

export type AdminEventActionResult =
  | { ok: true; message?: string; id?: string; slug?: string; count?: number }
  | { ok: false; message: string };

function fail(message: string): AdminEventActionResult {
  return { ok: false, message };
}

function ok(
  message?: string,
  extra?: { id?: string; slug?: string; count?: number },
): AdminEventActionResult {
  return { ok: true, message, ...extra };
}

async function requireAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, error: fail("Нужно войти в аккаунт.") };
  }
  if (!(await userIsAdmin(supabase))) {
    return { supabase, error: fail("Только для администраторов.") };
  }
  return { supabase, error: null as null };
}

function eventsTable(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
) {
  return (supabase as unknown as SupabaseClient).from("events");
}

function normalizeHttpUrl(raw: string | undefined | null): string | null {
  const value = raw?.trim() || null;
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return null;
  return value;
}

function normalizeTelegramUrl(raw: string | undefined | null): string | null {
  const value = raw?.trim() || null;
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const handle = value.replace(/^@/, "");
  if (/^[A-Za-z0-9_]{4,32}$/.test(handle)) {
    return `https://t.me/${handle}`;
  }
  return null;
}

function buildEventAtLabel(startsAt: string | null): string | null {
  if (!startsAt) return null;
  const parsed = new Date(startsAt);
  if (Number.isNaN(parsed.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(parsed);
  } catch {
    return null;
  }
}

export async function adminUpdateEventAction(input: {
  id: string;
  title: string;
  description?: string;
  city?: string;
  addressLine?: string;
  venueName?: string;
  startsAt?: string;
  dateUnknown?: boolean;
  registrationUrl?: string;
  phone?: string;
  telegramUrl?: string;
  priceLabel?: string;
  format?: "online" | "offline" | "hybrid" | "unknown";
  status?: "draft" | "published" | "archived";
  stateCode?: string;
}): Promise<AdminEventActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const id = input.id?.trim();
  if (!id) return fail("Не указан id.");

  const title = input.title?.trim();
  if (!title || title.length < 3) {
    return fail("Укажите название (минимум 3 символа).");
  }

  const format = input.format || "unknown";
  const addressLine = input.addressLine?.trim().slice(0, 240) || null;
  if ((format === "offline" || format === "hybrid") && !addressLine) {
    return fail("Для офлайн и гибрид укажите адрес площадки.");
  }

  let startsAt: string | null = null;
  if (!input.dateUnknown && input.startsAt?.trim()) {
    const parsed = new Date(input.startsAt.trim());
    if (Number.isNaN(parsed.getTime())) {
      return fail("Некорректная дата.");
    }
    startsAt = parsed.toISOString();
  }

  const registration = normalizeHttpUrl(input.registrationUrl);
  if (input.registrationUrl?.trim() && !registration) {
    return fail("Ссылка должна начинаться с http:// или https://");
  }
  const telegramUrl = normalizeTelegramUrl(input.telegramUrl);
  if (input.telegramUrl?.trim() && !telegramUrl) {
    return fail("Telegram: укажите @username или https://t.me/…");
  }

  const status = input.status ?? "published";
  if (!["draft", "published", "archived"].includes(status)) {
    return fail("Некорректный статус.");
  }

  const rawDescription = input.description?.trim().slice(0, 8000) || null;
  const description = rawDescription
    ? (redactContactsFromPublicText(rawDescription) ?? "").trim() || null
    : null;

  const { data: existing, error: loadError } = await eventsTable(supabase)
    .select("id, slug")
    .eq("id", id)
    .maybeSingle();
  if (loadError || !existing) {
    return fail(loadError?.message || "Событие не найдено.");
  }
  const slug = String((existing as { slug: string }).slug);

  const { error: updateError } = await eventsTable(supabase)
    .update({
      title: title.slice(0, 160),
      description,
      city: input.city?.trim().slice(0, 80) || null,
      address_line: addressLine,
      venue_name: input.venueName?.trim().slice(0, 160) || null,
      starts_at: startsAt,
      event_at_label: input.dateUnknown
        ? "Дата уточняется"
        : buildEventAtLabel(startsAt),
      registration_url: registration,
      phone: input.phone?.trim().slice(0, 40) || null,
      telegram_url: telegramUrl,
      price_label: input.priceLabel?.trim().slice(0, 80) || null,
      format,
      status,
      state_code: input.stateCode?.trim().slice(0, 16) || null,
    })
    .eq("id", id);

  if (updateError) {
    return fail(updateError.message || "Не удалось сохранить.");
  }

  revalidatePath("/admin/catalog/events");
  revalidatePath(`/admin/catalog/events/${id}/edit`);
  revalidatePath("/events");
  revalidatePath(`/events/${slug}`);
  revalidatePath("/events/mine");
  return ok("Событие сохранено.", { id, slug });
}

export async function adminSetEventStatusAction(input: {
  id: string;
  status: "draft" | "published" | "archived";
}): Promise<AdminEventActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const id = input.id?.trim();
  if (!id) return fail("Не указан id.");
  if (!["draft", "published", "archived"].includes(input.status)) {
    return fail("Некорректный статус.");
  }

  const { data: existing, error: loadError } = await eventsTable(supabase)
    .select("id, slug")
    .eq("id", id)
    .maybeSingle();
  if (loadError || !existing) {
    return fail(loadError?.message || "Событие не найдено.");
  }
  const slug = String((existing as { slug: string }).slug);

  const { error: updateError } = await eventsTable(supabase)
    .update({ status: input.status })
    .eq("id", id);
  if (updateError) {
    return fail(updateError.message || "Не удалось сменить статус.");
  }

  revalidatePath("/admin/catalog/events");
  revalidatePath(`/admin/catalog/events/${id}/edit`);
  revalidatePath("/events");
  revalidatePath(`/events/${slug}`);
  revalidatePath("/events/mine");
  const label =
    input.status === "archived"
      ? "Событие в архиве."
      : input.status === "published"
        ? "Событие снова опубликовано."
        : "Событие в черновике.";
  return ok(label, { id, slug });
}

/** Archive published events whose starts_at is in the past (admin button / cron later). */
export async function adminArchivePastEventsAction(): Promise<AdminEventActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { data, error: listError } = await eventsTable(supabase)
    .select("id, slug, starts_at")
    .eq("status", "published")
    .not("starts_at", "is", null)
    .limit(500);
  if (listError) {
    return fail(listError.message || "Не удалось загрузить события.");
  }

  const pastIds = ((data ?? []) as Array<{ id: string; starts_at: string | null }>)
    .filter((row) => isEventPast(row.starts_at))
    .map((row) => row.id);

  if (pastIds.length === 0) {
    return ok("Прошедших опубликованных событий нет.", { count: 0 });
  }

  const { error: updateError } = await eventsTable(supabase)
    .update({ status: "archived" })
    .in("id", pastIds);
  if (updateError) {
    return fail(updateError.message || "Не удалось архивировать.");
  }

  revalidatePath("/admin/catalog/events");
  revalidatePath("/events");
  return ok(`В архив: ${pastIds.length}.`, { count: pastIds.length });
}
