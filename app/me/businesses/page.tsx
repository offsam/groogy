import Link from "next/link";
import { redirect } from "next/navigation";
import { CabinetLeftNav } from "@/components/profile/CabinetLeftNav";
import { getOwnedBusinessesForPublisher } from "@/lib/listings/queries";
import { createServerClient } from "@/lib/supabase/server";
import { getProfileById } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

export default async function MeBusinessesPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/me/businesses");
  }

  const [profile, businesses] = await Promise.all([
    getProfileById(supabase, user.id),
    getOwnedBusinessesForPublisher(supabase, user.id).catch(() => []),
  ]);

  return (
    <div className="cabinet-wide mx-auto flex max-w-[1400px] flex-col gap-4 px-3 py-6 pb-24 sm:px-6 md:flex-row md:pb-6 lg:px-8">
      <CabinetLeftNav
        active="businesses"
        username={profile?.username ?? null}
      />
      <div className="min-w-0 flex-1 space-y-4">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">
            Мои бизнесы
          </h1>
          <p className="text-sm text-slate-500">
            Карточки бизнесов, привязанные к вашему аккаунту.
          </p>
        </header>

        {businesses.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            <p>Пока нет привязанных бизнесов.</p>
            <Link
              className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-brand-blue hover:underline"
              href="/add-business"
            >
              Добавить бизнес
            </Link>
          </div>
        ) : (
          <ul className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            {businesses.map((b) => (
              <li key={b.id}>
                <Link
                  className="inline-flex min-h-11 items-center text-sm font-medium text-brand-blue hover:underline"
                  href={`/business/${b.slug}`}
                >
                  {b.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
