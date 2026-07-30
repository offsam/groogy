import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminBusinessForm } from "@/components/admin/AdminBusinessForm";
import { AdminPublishedDuplicatesButton } from "@/components/admin/AdminPublishedDuplicatesButton";
import { AdminPublishedEnrichButton } from "@/components/admin/AdminPublishedEnrichButton";
import { CONTACT_LINKS_COLUMN_READY } from "@/lib/contacts/channels";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import { getActiveCategories } from "@/lib/supabase/queries";

export const metadata: Metadata = {
  title: "Редактировать бизнес — Admin",
};

type PageProps = { params: Promise<{ id: string }> };

const BUSINESS_EDIT_SELECT_BASE =
  "id, name, slug, short_description, description, phone, email, website, instagram_url, telegram_url, google_maps_url, google_rating, google_reviews_count, city, address_line, region, state_code, postal_code, status, category_id" as const;

const BUSINESS_EDIT_SELECT = (
  CONTACT_LINKS_COLUMN_READY
    ? `${BUSINESS_EDIT_SELECT_BASE}, contact_links`
    : BUSINESS_EDIT_SELECT_BASE
) as typeof BUSINESS_EDIT_SELECT_BASE;

export default async function AdminEditBusinessPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/admin/businesses/${id}/edit`);
  if (!(await userIsAdmin(supabase))) redirect("/");

  const [{ data: business }, categories] = await Promise.all([
    supabase
      .from("businesses")
      .select(BUSINESS_EDIT_SELECT)
      .eq("id", id)
      .maybeSingle(),
    getActiveCategories(supabase),
  ]);

  if (!business) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          className="text-sm text-slate-500 hover:text-slate-900"
          href="/admin/businesses"
        >
          ← К бизнесам
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
          Редактировать бизнес
        </h1>
        <p className="mt-1 text-sm text-slate-500">{business.name}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <AdminPublishedEnrichButton
            entityId={business.id}
            kind="business"
            slug={business.slug}
          />
          <AdminPublishedDuplicatesButton
            entityId={business.id}
            kind="business"
            slug={business.slug}
          />
          {business.status === "approved" ? (
            <Link
              href={`/business/${business.slug}`}
              className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              target="_blank"
              rel="noreferrer"
            >
              Открыть публичную
            </Link>
          ) : null}
        </div>
      </div>
      <AdminBusinessForm
        categories={categories}
        initial={{
          id: business.id,
          name: business.name,
          slug: business.slug,
          short_description: business.short_description,
          description: business.description,
          phone: business.phone,
          email: business.email,
          website: business.website,
          instagram_url: business.instagram_url,
          telegram_url: business.telegram_url,
          contact_links: (business as { contact_links?: unknown }).contact_links,
          google_maps_url: business.google_maps_url,
          google_rating: business.google_rating,
          google_reviews_count: business.google_reviews_count,
          city: business.city,
          address_line: business.address_line,
          region: business.region,
          state_code: business.state_code,
          postal_code: business.postal_code,
          status: business.status,
          category_id: business.category_id,
        }}
      />
    </div>
  );
}
