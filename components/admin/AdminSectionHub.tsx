import Link from "next/link";
import type { AdminSearchHit } from "@/lib/admin/section-search";
import type { AdminSection } from "@/lib/admin/sections";

export function AdminSectionHub({
  section,
  query,
  hits,
  children,
}: {
  section: AdminSection;
  query: string;
  hits: AdminSearchHit[];
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          {section.label}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{section.description}</p>
      </div>

      <form action={section.href} className="flex flex-col gap-2 sm:flex-row">
        <input
          className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none ring-brand-blue focus:ring-2"
          defaultValue={query}
          name="q"
          placeholder={section.searchPlaceholder}
          type="search"
        />
        <button
          className="min-h-11 shrink-0 rounded-xl bg-brand-blue px-4 text-sm font-semibold text-white"
          type="submit"
        >
          Найти
        </button>
      </form>

      {query.trim().length > 0 ? (
        hits.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">
            Ничего не нашлось по «{query.trim()}».
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {hits.map((hit) => (
              <li key={hit.id}>
                <Link
                  className="block min-h-11 px-3 py-3 hover:bg-slate-50 sm:px-4"
                  href={hit.href}
                >
                  <span className="block text-sm font-medium text-slate-900">
                    {hit.title}
                  </span>
                  <span className="mt-0.5 block break-words text-xs text-slate-500">
                    {hit.hint}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}

      <ul className="grid gap-2 sm:grid-cols-2">
        {section.links.map((item) => (
          <li key={item.href}>
            <Link
              className="block min-h-11 rounded-xl border border-slate-200 bg-white p-3 hover:border-brand-blue/40"
              href={item.href}
            >
              <span className="block text-sm font-semibold text-slate-900">
                {item.label}
              </span>
              <span className="mt-0.5 block text-xs text-slate-500">
                {item.description}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {children}
    </div>
  );
}
