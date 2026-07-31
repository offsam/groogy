import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ensureProfileUsername } from "@/lib/profile/ensure-username";
import { createServerClient } from "@/lib/supabase/server";
import { getProfileById } from "@/lib/supabase/queries";

export const metadata: Metadata = {
  title: "Профиль — КРУГИ",
};

/**
 * Legacy cabinet URL — always land on the public card (/u/username).
 * Allocates username if missing (older accounts).
 */
export default async function ProfilePage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/profile");
  }

  let profile = await getProfileById(supabase, user.id);
  let username = profile?.username ?? null;

  if (!username) {
    username = await ensureProfileUsername(supabase, user.id, {
      displayName: profile?.display_name,
      email: user.email,
    });
    if (username) {
      profile = await getProfileById(supabase, user.id);
      username = profile?.username ?? username;
    }
  }

  if (username) {
    redirect(`/u/${username}`);
  }

  // Extremely rare: could not allocate — show minimal message
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-slate-900">Профиль</h1>
      <p className="mt-2 text-sm text-slate-600">
        Не удалось создать username. Обновите страницу или напишите в поддержку.
      </p>
    </div>
  );
}
