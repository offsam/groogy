import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MyEventEditForm } from "@/components/events/MyEventEditForm";
import { getEventBySlugForOwner } from "@/lib/events/queries";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Редактировать событие — КРУГИ",
};

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function EditMyEventPage({ params }: PageProps) {
  const { slug } = await params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/events/${slug}/edit`);

  const event = await getEventBySlugForOwner(supabase, slug, user.id).catch(
    () => null,
  );
  if (!event) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-3 py-6 sm:px-6 sm:py-8">
      <div>
        <p className="text-sm">
          <Link href="/events/mine" className="text-brand-blue hover:underline">
            ← Мои события
          </Link>
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-slate-900">
          Править событие
        </h1>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <MyEventEditForm
          initial={{
            id: event.id,
            title: event.title,
            slug: event.slug,
            description: event.description,
            city: event.city,
            address_line: event.address_line ?? null,
            starts_at: event.starts_at,
            event_at_label: event.event_at_label,
            registration_url: event.registration_url,
            phone: event.phone ?? null,
            telegram_url: event.telegram_url ?? null,
            price_label: event.price_label ?? null,
            format: event.format,
            status: event.status,
          }}
        />
      </div>
    </div>
  );
}
