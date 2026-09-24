import Link from "next/link";
import { redirect } from "next/navigation";
import { CabinetLeftNav } from "@/components/profile/CabinetLeftNav";
import type { CabinetNavKey } from "@/types/profile-cabinet";
import { createServerClient } from "@/lib/supabase/server";
import { getProfileById } from "@/lib/supabase/queries";

type Props = {
  title: string;
  description: string;
  navKey: CabinetNavKey;
};

export async function MePlaceholderPage({
  title,
  description,
  navKey,
}: Props) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=/me/${navKey === "profile" ? "" : navKey}`);
  }

  const profile = await getProfileById(supabase, user.id);

  return (
    <div className="cabinet-wide mx-auto flex max-w-[1400px] flex-col gap-4 px-3 py-6 pb-24 sm:px-6 md:flex-row md:pb-6 lg:px-8">
      <CabinetLeftNav active={navKey} username={profile?.username ?? null} />
      <div className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">{description}</p>
        <p className="mt-4 text-sm text-slate-400">Раздел в разработке.</p>
        <Link
          className="mt-6 inline-flex min-h-11 items-center text-sm font-medium text-brand-blue hover:underline"
          href={profile?.username ? `/u/${profile.username}` : "/profile"}
        >
          ← К профилю
        </Link>
      </div>
    </div>
  );
}
