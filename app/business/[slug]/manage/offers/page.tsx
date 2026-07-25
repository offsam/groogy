import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OfferManageList } from "@/components/business-offers/OfferManageList";
import { getOwnerOffersForBusiness } from "@/lib/business-offers/queries";
import { createServerClient } from "@/lib/supabase/server";
import { getBusinessBySlugForOwner } from "@/lib/supabase/queries";
import { userOwnsBusiness } from "@/lib/reviews/queries";

type OffersManagePageProps = {
  params: Promise<{ slug: string }>;
};

export default async function OffersManagePage({ params }: OffersManagePageProps) {
  const { slug } = await params;
  const client = await createServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) redirect(`/login?next=/business/${slug}/manage/offers`);

  const business = await getBusinessBySlugForOwner(client, slug);
  if (!business) notFound();

  const owns = await userOwnsBusiness(client, business.id);
  const { data: isAdmin } = await client.rpc("is_admin");
  if (!owns && !isAdmin) notFound();

  const offers = await getOwnerOffersForBusiness(client, business.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            className="text-sm text-slate-500 hover:text-slate-900"
            href={`/business/${slug}/manage`}
          >
            ← Управление
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Предложения</h1>
        </div>
        <Link
          className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white"
          href={`/business/${slug}/manage/offers/new`}
        >
          Создать
        </Link>
      </div>

      <OfferManageList
        businessId={business.id}
        businessSlug={slug}
        offers={offers}
      />
    </div>
  );
}
