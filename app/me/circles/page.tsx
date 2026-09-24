import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CabinetLeftNav } from "@/components/profile/CabinetLeftNav";
import { FollowEntityButton } from "@/components/shared/FollowEntityButton";
import { listMyCircles } from "@/lib/updates/queries";
import { createServerClient } from "@/lib/supabase/server";
import { getProfileById } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

export default async function MeCirclesPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/me/circles");
  }

  const [profile, circles] = await Promise.all([
    getProfileById(supabase, user.id),
    listMyCircles(supabase, user.id),
  ]);

  return (
    <div className="cabinet-wide mx-auto flex max-w-[1400px] flex-col gap-4 px-3 py-6 pb-24 sm:px-6 md:flex-row md:pb-6 lg:px-8">
      <CabinetLeftNav active="circles" username={profile?.username ?? null} />
      <div className="min-w-0 flex-1 space-y-4">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">
            Мои круги
          </h1>
          <p className="text-sm text-slate-500">
            Карточки, которые вы добавили кнопкой «Добавить в круги».
          </p>
        </header>

        {circles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            <p>Пока пусто.</p>
            <p className="mt-2">
              Откройте{" "}
              <Link
                className="font-medium text-brand-blue hover:underline"
                href="/search"
              >
                каталог
              </Link>{" "}
              и нажмите «Добавить в круги» на бизнесе или специалисте.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {circles.map((item) => (
              <li
                className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
                key={`${item.ownerType}:${item.ownerId}`}
              >
                <Link
                  className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-slate-100"
                  href={item.href}
                >
                  {item.imageUrl ? (
                    <Image
                      alt=""
                      className="object-cover"
                      fill
                      sizes="56px"
                      src={item.imageUrl}
                      unoptimized
                    />
                  ) : (
                    <span className="flex h-full items-center justify-center text-lg font-semibold text-slate-400">
                      {item.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                </Link>

                <div className="min-w-0 flex-1">
                  <Link
                    className="block truncate text-sm font-semibold text-slate-900 hover:text-brand-blue"
                    href={item.href}
                  >
                    {item.name}
                  </Link>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {item.ownerType === "business" ? "Бизнес" : "Специалист"}
                  </p>
                </div>

                <FollowEntityButton
                  initialFollowing
                  isAuthenticated
                  ownerId={item.ownerId}
                  ownerType={item.ownerType}
                  revalidatePath="/me/circles"
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
