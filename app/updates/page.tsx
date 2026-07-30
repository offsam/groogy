import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { listPublicUpdates } from "@/lib/updates/queries";
import { UpdateCard } from "@/components/shared/UpdateCard";

export const dynamic = "force-dynamic";

export default async function UpdatesPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const updates = await listPublicUpdates(supabase, { limit: 60 });

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Обновления
          </h1>
          {user ? (
            <Link
              href="/updates/mine"
              className="text-sm font-medium text-brand-blue hover:underline"
            >
              Мои обновления
            </Link>
          ) : null}
        </div>
        <p className="max-w-2xl text-sm text-slate-600 sm:text-base">
          Новости от бизнесов и специалистов: переезд, открытие, смена адреса.
        </p>
      </header>

      <section className="mt-6 space-y-3" aria-live="polite">
        {updates.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            Пока нет обновлений.
          </p>
        ) : (
          updates.map((update) => (
            <UpdateCard key={update.id} update={update} showOwner />
          ))
        )}
      </section>
    </main>
  );
}
