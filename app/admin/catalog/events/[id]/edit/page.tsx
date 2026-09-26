import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminEventForm } from "@/components/admin/AdminEventForm";
import { getEventByIdForAdmin } from "@/lib/events/queries";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Редактировать событие — Admin",
};

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function AdminEditEventPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/admin/catalog/events/${id}/edit`);
  if (!(await userIsAdmin(supabase))) redirect("/");

  const event = await getEventByIdForAdmin(supabase, id).catch(() => null);
  if (!event) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {event.title}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Редактирование события в админке
        </p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <AdminEventForm
          initial={{
            id: event.id,
            title: event.title,
            slug: event.slug,
            description: event.description,
            city: event.city,
            address_line: event.address_line ?? null,
            venue_name: event.venue_name ?? null,
            starts_at: event.starts_at,
            event_at_label: event.event_at_label,
            registration_url: event.registration_url,
            phone: event.phone ?? null,
            telegram_url: event.telegram_url ?? null,
            price_label: event.price_label ?? null,
            format: event.format,
            status: event.status,
            state_code: event.state_code ?? null,
          }}
        />
      </div>
    </div>
  );
}
