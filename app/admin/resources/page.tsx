import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import {
  PARSE_RESOURCE_STATUS_LABEL,
  getParseResourceCategories,
} from "@/lib/import-review/parse-resources";

export const metadata: Metadata = {
  title: "Ресурсы — Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminResourcesPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/resources");
  if (!(await userIsAdmin(supabase))) redirect("/");

  const categories = getParseResourceCategories();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          Ресурсы
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Откуда можем парсить. Списки в коде, без базы.
        </p>
        <nav className="mt-3 flex flex-wrap gap-2 text-sm">
          {categories.map((cat) => (
            <a
              key={cat.id}
              href={`#${cat.id}`}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:border-brand-blue/40 hover:text-brand-blue"
            >
              {cat.title}
              <span className="ml-1 tabular-nums text-slate-400">
                {cat.items.length}
              </span>
            </a>
          ))}
        </nav>
      </div>

      {categories.map((cat) => (
        <section key={cat.id} id={cat.id} className="scroll-mt-4 space-y-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{cat.title}</h2>
            <p className="text-sm text-slate-500">{cat.description}</p>
          </div>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {cat.items.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  {item.href ? (
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-slate-900 hover:text-brand-blue hover:underline"
                    >
                      {item.title}
                    </a>
                  ) : (
                    <span className="font-medium text-slate-900">
                      {item.title}
                    </span>
                  )}
                  <p className="text-xs text-slate-500">
                    {item.region}
                    {item.note ? ` · ${item.note}` : ""}
                  </p>
                </div>
                <span
                  className={`w-fit shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    item.status === "pipeline"
                      ? "bg-brand-green/15 text-emerald-900"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {PARSE_RESOURCE_STATUS_LABEL[item.status]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
