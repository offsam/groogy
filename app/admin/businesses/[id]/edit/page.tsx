import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminBusinessForm } from "@/components/admin/AdminBusinessForm";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import { getActiveCategories } from "@/lib/supabase/queries";

export const metadata: Metadata = {
  title: "Редактировать бизнес — Admin",
};

type PageProps = { params: Promise<{ id: string }> };

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
      .select(
        "id, name, slug, short_description, description, phone, website, instagram_url, google_maps_url, google_rating, google_reviews_count, city, address_line, region, state_code, postal_code, status, category_id",
      )
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
          website: business.website,
          instagram_url: business.instagram_url,
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
