import Link from "next/link";
import { redirect } from "next/navigation";
import { CabinetLeftNav } from "@/components/profile/CabinetLeftNav";
import { createServerClient } from "@/lib/supabase/server";
import { getProfileById } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

export default async function MeSurroundingsPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/me/surroundings");
  }

  const profile = await getProfileById(supabase, user.id);

  return (
    <div className="cabinet-wide mx-auto flex max-w-[1400px] flex-col gap-4 px-3 py-6 pb-24 sm:px-6 md:flex-row md:pb-6 lg:px-8">
      <CabinetLeftNav
        active="surroundings"
        username={profile?.username ?? null}
      />
      <div className="min-w-0 flex-1 space-y-4">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">
            Моё окружение
          </h1>
          <p className="text-sm text-slate-500">
            Люди, которых вы добавили в окружение.
          </p>
        </header>

        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          <p>Пока пусто.</p>
          <p className="mt-2">
            Когда появится добавление в окружение, здесь будут профили людей.
          </p>
          <Link
            className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-brand-blue hover:underline"
            href={profile?.username ? `/u/${profile.username}` : "/profile"}
          >
            ← К профилю
          </Link>
        </div>
      </div>
    </div>
  );
}
