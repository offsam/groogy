import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getBusinessBySlugForOwner } from "@/lib/supabase/queries";
import { userOwnsBusiness } from "@/lib/reviews/queries";

type ManagePageProps = {
  params: Promise<{ slug: string }>;
};

export default async function BusinessManagePage({ params }: ManagePageProps) {
  const { slug } = await params;
  const client = await createServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) redirect(`/login?next=/business/${slug}/manage`);

  const business = await getBusinessBySlugForOwner(client, slug);
  if (!business) notFound();

  const owns = await userOwnsBusiness(client, business.id);
  const { data: isAdmin } = await client.rpc("is_admin");
  if (!owns && !isAdmin) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <p className="text-sm text-slate-500">Управление</p>
        <h1 className="text-2xl font-bold text-slate-900">{business.name}</h1>
      </div>

      <nav className="grid gap-3 sm:grid-cols-2">
        <Link
          className="rounded-2xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-md"
          href={`/business/${slug}/manage/offers`}
        >
          <h2 className="font-semibold text-slate-900">Предложения</h2>
          <p className="mt-1 text-sm text-slate-600">
            Услуги, товары, меню и другие позиции
          </p>
        </Link>
        <Link
          className="rounded-2xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-md"
          href={`/business/${slug}`}
        >
          <h2 className="font-semibold text-slate-900">Публичная страница</h2>
          <p className="mt-1 text-sm text-slate-600">Посмотреть, как видят клиенты</p>
        </Link>
      </nav>
    </div>
  );
}
