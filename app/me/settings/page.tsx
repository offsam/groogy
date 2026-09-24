import { redirect } from "next/navigation";
import { CabinetLeftNav } from "@/components/profile/CabinetLeftNav";
import { ProfileSettingsForm } from "@/components/auth/ProfileSettingsForm";
import { getUsStates } from "@/lib/master-data/queries";
import { createServerClient } from "@/lib/supabase/server";
import { getProfileById } from "@/lib/supabase/queries";

export default async function MeSettingsPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/me/settings");
  }

  const [profile, usStates] = await Promise.all([
    getProfileById(supabase, user.id),
    getUsStates().catch(() => []),
  ]);

  if (!profile) {
    redirect("/login?next=/me/settings");
  }

  return (
    <div className="cabinet-wide mx-auto flex max-w-[1400px] flex-col gap-4 px-3 py-6 pb-24 sm:px-6 md:flex-row md:pb-6 lg:px-8">
      <CabinetLeftNav active="settings" username={profile.username ?? null} />
      <div className="min-w-0 flex-1 space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <h1 className="text-xl font-semibold text-slate-900">Настройки</h1>
          <p className="mt-1 text-sm text-slate-500">
            Имя, username, видимость и что показывать другим.
          </p>
          <p className="mt-1 text-xs text-slate-400">{user.email}</p>
          <div className="mt-4">
            <ProfileSettingsForm profile={profile} usStates={usStates} />
          </div>
        </section>
      </div>
    </div>
  );
}
