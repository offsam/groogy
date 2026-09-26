import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/ui/DataState";
import { listEventsForOwner } from "@/lib/events/queries";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Мои события — КРУГИ",
};

export const dynamic = "force-dynamic";

const STATUS_RU: Record<string, string> = {
  published: "На сайте",
  draft: "Черновик",
  archived: "В архиве",
};

export default async function MyEventsPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/events/mine");

  let events: Awaited<ReturnType<typeof listEventsForOwner>> = [];
  try {
    events = await listEventsForOwner(supabase, user.id);
  } catch {
    events = [];
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-3 py-6 sm:px-6 sm:py-8">
      <div>
        <p className="text-sm">
          <Link href="/events" className="text-brand-blue hover:underline">
            ← Все события
          </Link>
        </p>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Мои события
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Анонсы, которые вы добавили. Можно править или убрать с сайта.
        </p>
        <p className="mt-3">
          <Link
            href="/events/new"
            className="inline-flex min-h-11 items-center rounded-xl bg-brand-blue px-4 text-sm font-medium text-white hover:bg-brand-blue-deep"
          >
            Добавить событие
          </Link>
        </p>
      </div>

      {events.length === 0 ? (
        <EmptyState
          title="Пока пусто"
          description="Добавьте первое событие — оно появится здесь."
        />
      ) : (
        <ul className="space-y-3">
          {events.map((event) => (
            <li
              key={event.id}
              className="rounded-2xl border border-slate-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-900">{event.title}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {STATUS_RU[event.status] ?? event.status}
                    {event.event_at_label
                      ? ` · ${event.event_at_label}`
                      : event.starts_at
                        ? ` · ${new Date(event.starts_at).toLocaleString("ru-RU")}`
                        : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {event.status === "published" ? (
                    <Link
                      href={`/events/${event.slug}`}
                      className="inline-flex min-h-11 items-center rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-800"
                    >
                      На сайте
                    </Link>
                  ) : null}
                  <Link
                    href={`/events/${event.slug}/edit`}
                    className="inline-flex min-h-11 items-center rounded-lg bg-slate-900 px-3 text-xs font-medium text-white"
                  >
                    Править
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
