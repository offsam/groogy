import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import { getParseResourceCategory } from "@/lib/import-review/parse-resources";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ category: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params;
  const cat = getParseResourceCategory(category);
  return {
    title: cat ? `${cat.title} — Источники — Admin` : "Источники — Admin",
  };
}

export default async function AdminSourceCategoryPage({ params }: Props) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { category } = await params;
  if (!user) redirect(`/login?next=/admin/sources/${category}`);
  if (!(await userIsAdmin(supabase))) redirect("/");

  const cat = getParseResourceCategory(category);
  if (!cat) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          {cat.title}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{cat.description}</p>
      </div>

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {cat.items.map((item) => (
          <li key={item.id} className="px-3 py-2.5">
            {item.href ? (
              <a
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-brand-blue hover:underline"
              >
                {item.title}
              </a>
            ) : (
              <span className="font-medium text-slate-900">{item.title}</span>
            )}
            <p className="truncate text-xs text-slate-500">
              {item.region}
              {item.href ? ` · ${item.href}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
