import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        404
      </p>
      <h1 className="text-2xl font-semibold text-slate-900">Страница не найдена</h1>
      <p className="text-slate-600">
        Ссылка устарела или карточка была перенесена.
      </p>
      <Link
        className="rounded-full bg-brand-blue px-5 py-2.5 text-sm font-semibold text-white"
        href="/"
      >
        На главную
      </Link>
    </main>
  );
}
