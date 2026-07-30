import type { Metadata } from "next";
import Link from "next/link";
import { INBOX_VIEWS, WRONG_SECTION_VIEW } from "@/lib/admin/inbox/views";

export const metadata: Metadata = {
  title: "Saved Views — Admin",
};

export default function AdminReviewViewsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-sm font-medium text-brand-blue-deep">Review Center</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          Saved Views
        </h1>
        <p className="mt-2 text-slate-500">
          Системные пресеты фильтров над Inbox. Пользовательские Saved Views
          подключаются через тот же реестр (`listInboxViews`).
        </p>
      </div>

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {INBOX_VIEWS.map((view) => {
          const href =
            view.id === "all"
              ? "/admin/review/inbox"
              : `/admin/review/inbox?view=${view.id}`;
          return (
            <li key={view.id}>
              <Link
                href={href}
                className="flex items-start justify-between gap-4 px-4 py-3.5 hover:bg-slate-50"
              >
                <div>
                  <p className="font-medium text-slate-900">{view.label}</p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {view.description}
                  </p>
                </div>
                <span className="shrink-0 text-sm text-brand-blue">Open →</span>
              </Link>
            </li>
          );
        })}
        <li>
          <Link
            href={WRONG_SECTION_VIEW.href}
            className="flex items-start justify-between gap-4 px-4 py-3.5 hover:bg-slate-50"
          >
            <div>
              <p className="font-medium text-slate-900">
                {WRONG_SECTION_VIEW.label}
              </p>
              <p className="mt-0.5 text-sm text-slate-500">
                {WRONG_SECTION_VIEW.description}
              </p>
            </div>
            <span className="shrink-0 text-sm text-brand-blue">Open →</span>
          </Link>
        </li>
      </ul>
    </div>
  );
}
