import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminChurchForm } from "@/components/admin/AdminChurchForm";
import { getChurchOwnerById } from "@/lib/churches/queries";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Редактировать церковь — Admin",
};

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function AdminEditChurchPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/admin/catalog/churches/${id}/edit`);
  if (!(await userIsAdmin(supabase))) redirect("/");

  const church = await getChurchOwnerById(supabase, id).catch(() => null);
  if (!church) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {church.name}
        </h1>
        <p className="mt-1 text-sm text-slate-600">Редактирование карточки</p>
      </div>
      <AdminChurchForm
        initial={{
          id: church.id,
          name: church.name,
          slug: church.slug,
          description: church.description,
          phone: church.phone,
          email: church.email,
          website: church.website,
          instagram_url: church.instagramUrl,
          telegram_url: church.telegramUrl,
          google_maps_url: church.googleMapsUrl ?? null,
          contact_links: church.contactLinks,
          city: church.city,
          address_line: church.addressLine,
          region: church.region,
          state_code: church.stateCode,
          postal_code: church.postalCode,
          status: church.status,
          source_url: church.sourceUrl,
          source_kind: church.sourceKind,
          image_url:
            church.imageUrl && church.imageUrl !== "/placeholder.svg"
              ? church.imageUrl
              : null,
          schedule_text: church.scheduleText ?? null,
          ministries: church.ministries ?? [],
        }}
      />
    </div>
  );
}
