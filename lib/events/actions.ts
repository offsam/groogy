"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";

export type EventActionResult =
  | { ok: true; slug: string; id: string }
  | { ok: false; error: string };

function fail(error: string): EventActionResult {
  return { ok: false, error };
}

const CYR_TO_LAT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "i",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "c",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

function slugifyEventTitle(input: string): string {
  const chars: string[] = [];
  for (const ch of input.toLowerCase()) {
    if (CYR_TO_LAT[ch] !== undefined) chars.push(CYR_TO_LAT[ch]);
    else if (/[a-z0-9]/.test(ch)) chars.push(ch);
    else if (/\s|-|_/.test(ch)) chars.push("-");
  }
  const base =
    chars
      .join("")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "event";
  const stamp = Date.now().toString(36).slice(-5);
  return `${base}-${stamp}`;
}

export async function createEventAction(input: {
  title: string;
  description?: string;
  city?: string;
  startsAt?: string;
  registrationUrl?: string;
  format?: "online" | "offline" | "hybrid" | "unknown";
}): Promise<EventActionResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Войдите в аккаунт.");

  const title = input.title?.trim();
  if (!title || title.length < 3) {
    return fail("Укажите название события (минимум 3 символа).");
  }

  let startsAt: string | null = null;
  let eventAtLabel: string | null = null;
  if (input.startsAt?.trim()) {
    const raw = input.startsAt.trim();
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return fail("Некорректная дата.");
    }
    startsAt = parsed.toISOString();
    try {
      eventAtLabel = new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(parsed);
    } catch {
      eventAtLabel = null;
    }
  }

  const registration = input.registrationUrl?.trim() || null;
  if (registration && !/^https?:\/\//i.test(registration)) {
    return fail("Ссылка должна начинаться с http:// или https://");
  }

  const slug = slugifyEventTitle(title);
  const format = input.format || "unknown";

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
    .from("events")
    .insert({
      owner_profile_id: user.id,
      title: title.slice(0, 160),
      slug,
      description: input.description?.trim().slice(0, 8000) || null,
      city: input.city?.trim().slice(0, 80) || null,
      starts_at: startsAt,
      event_at_label: eventAtLabel,
      registration_url: registration,
      format,
      status: "published",
      source_channel: "user",
    })
    .select("id, slug")
    .single();

  if (error || !data) {
    return fail(error?.message ?? "Не удалось создать событие.");
  }

  revalidatePath("/events");
  revalidatePath(`/events/${data.slug}`);
  return { ok: true, id: data.id, slug: data.slug };
}
