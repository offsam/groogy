import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Служебное — Admin",
};

export default function AdminSystemIndexPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Служебное
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Категории и отчёты об ошибках.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        <li>
          <Link
            href="/admin/system/taxonomy"
            className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-400"
          >
            <h2 className="font-semibold text-slate-900">Категории</h2>
            <p className="mt-1 text-sm text-slate-500">
              Категории, языки, география
            </p>
          </Link>
        </li>
        <li>
          <Link
            href="/admin/system/error-reports"
            className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-400"
          >
            <h2 className="font-semibold text-slate-900">Ошибки</h2>
            <p className="mt-1 text-sm text-slate-500">
              Сообщения от пользователей
            </p>
          </Link>
        </li>
      </ul>
    </div>
  );
}
