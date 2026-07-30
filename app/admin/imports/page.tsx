import type { Metadata } from "next";
import Link from "next/link";
import { ADMIN_NAV } from "@/lib/admin/nav";
import { importsInboxHref } from "@/lib/admin/imports/inbox-href";

export const metadata: Metadata = {
  title: "Imports — Admin",
};

export default function AdminImportsIndexPage() {
  const section = ADMIN_NAV.find((s) => s.id === "imports");
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Imports
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Overview источников: история, provenance и диагностика внутри IA V2.
          Модерация — только в Review Center Inbox.
        </p>
        <p className="mt-3 flex flex-wrap gap-4 text-sm">
          <Link
            href={importsInboxHref()}
            className="font-medium text-brand-blue hover:underline"
          >
            Open Review Center Inbox →
          </Link>
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Sources
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {(section?.children ?? []).map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-400"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-slate-900">{item.label}</h3>
                  {item.comingSoon ? (
                    <span className="rounded bg-orange-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-orange-800">
                      Soon
                    </span>
                  ) : (
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                      History
                    </span>
                  )}
                </div>
                {item.description ? (
                  <p className="mt-1 text-sm text-slate-500">{item.description}</p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="font-semibold text-slate-900">History</h3>
          <p className="mt-1 text-sm text-slate-500">
            Детальная история по источникам — Telegram и Directories.
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <Link
              href="/admin/imports/telegram"
              className="font-medium text-brand-blue hover:underline"
            >
              Telegram →
            </Link>
            <Link
              href="/admin/imports/directories"
              className="font-medium text-brand-blue hover:underline"
            >
              Directories →
            </Link>
          </div>
        </div>
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4">
          <h3 className="font-semibold text-slate-900">Diagnostics</h3>
          <p className="mt-1 text-sm text-slate-500">
            Coming Soon — единая диагностика import pipelines. Пока смотрите
            stats на карточках источников.
          </p>
          <p className="mt-3 text-xs uppercase tracking-wide text-slate-400">
            Soon
          </p>
        </div>
      </section>
    </div>
  );
}
