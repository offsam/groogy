import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OfferForm } from "@/components/business-offers/OfferForm";
import { createServerClient } from "@/lib/supabase/server";
import {
  getActiveCategories,
  getBusinessBySlugForOwner,
} from "@/lib/supabase/queries";
import { userOwnsBusiness } from "@/lib/reviews/queries";

type NewOfferPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function NewOfferPage({ params }: NewOfferPageProps) {
  const { slug } = await params;
  const client = await createServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) redirect(`/login?next=/business/${slug}/manage/offers/new`);

  const business = await getBusinessBySlugForOwner(client, slug);
  if (!business) notFound();

  const owns = await userOwnsBusiness(client, business.id);
  const { data: isAdmin } = await client.rpc("is_admin");
  if (!owns && !isAdmin) notFound();

  const categories = await getActiveCategories(client);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        className="text-sm text-slate-500 hover:text-slate-900"
        href={`/business/${slug}/manage/offers`}
      >
        ← Предложения
      </Link>
      <h1 className="text-2xl font-bold text-slate-900">Новое предложение</h1>
      <OfferForm
        businessId={business.id}
        businessSlug={slug}
        categories={categories}
      />
    </div>
  );
}
