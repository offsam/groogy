import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getBusinessBySlugForOwner } from "@/lib/supabase/queries";
import { userIsAdmin, userOwnsBusiness } from "@/lib/reviews/queries";

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

  const [owns, isAdmin] = await Promise.all([
    userOwnsBusiness(client, business.id),
    userIsAdmin(client).catch(() => false),
  ]);
  if (!owns && !isAdmin) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <p className="text-sm text-slate-500">
          Управление{isAdmin ? " · режим администратора" : ""}
        </p>
        <h1 className="text-2xl font-bold text-slate-900">{business.name}</h1>
      </div>

      <nav className="grid gap-3 sm:grid-cols-2">
        <Link
          className="rounded-2xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-md"
          href={`/business/${slug}/manage/offers`}
        >
          <h2 className="font-semibold text-slate-900">Предложения</h2>
          <p className="mt-1 text-sm text-slate-600">
            Услуги, товары, меню, фото позиций
          </p>
        </Link>
        {isAdmin ? (
          <Link
            className="rounded-2xl border border-brand-blue/25 bg-brand-blue/5 p-5 transition-shadow hover:shadow-md"
            href={`/admin/businesses/${business.id}/edit`}
          >
            <h2 className="font-semibold text-brand-blue-deep">Редактировать карточку</h2>
            <p className="mt-1 text-sm text-slate-600">
              Название, описание, контакты, категория, статус
            </p>
          </Link>
        ) : null}
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
