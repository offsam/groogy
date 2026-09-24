"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";

export type SearchHistoryActionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string };

function fail(message: string): SearchHistoryActionResult {
  return { ok: false, message };
}

const DISMISS_COOKIE = "cabinet_search_dismissed";

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().slice(0, 80);
}

async function readDismissed(): Promise<string[]> {
  const jar = await cookies();
  const raw = jar.get(DISMISS_COOKIE)?.value;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string")
      .map(normalizeQuery)
      .filter(Boolean)
      .slice(0, 100);
  } catch {
    return [];
  }
}

async function writeDismissed(norms: string[]) {
  const jar = await cookies();
  jar.set({
    name: DISMISS_COOKIE,
    value: encodeURIComponent(JSON.stringify(norms.slice(0, 100))),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function getDismissedSearchNormsAction(): Promise<string[]> {
  return readDismissed();
}

export async function dismissSearchHistoryAction(
  historyId: string,
  queryNormalized?: string,
): Promise<SearchHistoryActionResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Нужно войти в аккаунт.");

  const norm =
    queryNormalized?.trim().toLowerCase() ||
    (historyId.startsWith("pe:") ? historyId.slice(3) : "");

  if (norm) {
    const dismissed = await readDismissed();
    if (!dismissed.includes(norm)) {
      await writeDismissed([...dismissed, norm]);
    }
  }

  if (!historyId.startsWith("pe:")) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("user_search_history")
      .update({ dismissed_at: new Date().toISOString() })
      .eq("id", historyId)
      .eq("user_id", user.id);
    if (error) {
      console.warn("[search-history] dismiss table failed:", error.message);
    }
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();

  revalidatePath("/profile");
  if (profile?.username) {
    revalidatePath(`/u/${profile.username}`);
  }

  return { ok: true, message: "Запрос скрыт." };
}
