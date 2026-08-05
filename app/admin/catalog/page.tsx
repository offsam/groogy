import type { Metadata } from "next";
import Link from "next/link";
import { ADMIN_NAV } from "@/lib/admin/nav";

export const metadata: Metadata = {
  title: "Каталог — Admin",
};

export default function AdminCatalogIndexPage() {
  const section = ADMIN_NAV.find((s) => s.id === "catalog");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Каталог
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Уже опубликованные карточки — по штату, округу и категории. Новые из
          импорта — в Очереди.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {(section?.children ?? []).map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-400"
            >
              <h2 className="font-semibold text-slate-900">{item.label}</h2>
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
