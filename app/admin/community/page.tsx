import type { Metadata } from "next";
import Link from "next/link";
import { ADMIN_NAV } from "@/lib/admin/nav";

export const metadata: Metadata = {
  title: "Community — Admin",
};

export default function AdminCommunityIndexPage() {
  const section = ADMIN_NAV.find((s) => s.id === "community");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Community
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Отзывы, рекомендации и репорты внутри IA V2. Рекомендации также в
          Review Center Inbox.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {(section?.children ?? []).map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-400"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold text-slate-900">{item.label}</h2>
                {item.comingSoon ? (
                  <span className="rounded bg-orange-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-orange-800">
                    Soon
                  </span>
                ) : null}
              </div>
              {item.description ? (
                <p className="mt-1 text-sm text-slate-500">{item.description}</p>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
