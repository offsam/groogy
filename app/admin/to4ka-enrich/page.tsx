import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { To4kaEnrichLiveStatus } from "@/components/admin/To4kaEnrichLiveStatus";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Обогащение to4ka — Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminTo4kaEnrichPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/to4ka-enrich");
  if (!(await userIsAdmin(supabase))) redirect("/");

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <p className="text-sm font-medium text-brand-blue-deep">Фоновые задачи</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
          Обогащение to4ka
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Массовый прогон опубликованных бизнесов из to4ka. Обновляется каждые
          5 сек. Чистку ложных email / ads делаем после завершения.
        </p>
        <p className="mt-3 flex flex-wrap gap-4 text-sm">
          <Link
            href="/admin/imports/directories/to4ka"
            className="text-brand-blue hover:underline"
          >
            Страница источника to4ka
          </Link>
          <Link
            href="/admin/catalog/businesses"
            className="text-brand-blue hover:underline"
          >
            Каталог бизнесов
          </Link>
        </p>
      </div>
      <To4kaEnrichLiveStatus />
    </div>
  );
}
