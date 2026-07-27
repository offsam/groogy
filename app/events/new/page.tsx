import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EventForm } from "@/components/events/EventForm";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Добавить событие — КРУГИ",
};

export default async function NewEventPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/events/new");
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
          Добавить событие
        </h1>
        <p className="mt-2 text-sm text-slate-500 sm:text-base">
          Встреча, эфир, митап или мастер-класс для сообщества.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <EventForm />
      </div>
    </div>
  );
}
