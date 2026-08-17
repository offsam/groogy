import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import { getParseResourceCategories } from "@/lib/import-review/parse-resources";

export const metadata: Metadata = {
  title: "Источники — Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminSourcesPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/sources");
  if (!(await userIsAdmin(supabase))) redirect("/");

  const categories = getParseResourceCategories();

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          Источники
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Откуда вытягиваем данные. Зайди в тип — внутри список со ссылками.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {categories.map((cat) => (
          <Link
            key={cat.id}
            href={`/admin/sources/${cat.id}`}
            className="flex min-h-[5.5rem] flex-col rounded-xl border border-slate-200 bg-white p-3 transition hover:border-slate-400"
          >
            <h2 className="text-sm font-semibold text-slate-900">{cat.title}</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">{cat.description}</p>
            <p className="mt-auto pt-2 text-lg font-semibold tabular-nums text-slate-900">
              {cat.items.length}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
