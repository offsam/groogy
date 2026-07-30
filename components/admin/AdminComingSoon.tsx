import Link from "next/link";

type Props = {
  title: string;
  description: string;
  /** Optional legacy tool still available */
  legacyHref?: string;
  legacyLabel?: string;
};

export function AdminComingSoon({
  title,
  description,
  legacyHref,
  legacyLabel,
}: Props) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-orange">
        Coming Soon
      </p>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
        {title}
      </h1>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-slate-600">
        {description}
      </p>
      <p className="mx-auto mt-4 max-w-md text-xs text-slate-500">
        Раздел заложен в Admin Panel IA V2. Логика появится на следующих фазах
        миграции — без новых корневых очередей.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/admin"
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          Dashboard
        </Link>
        {legacyHref ? (
          <Link
            href={legacyHref}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            {legacyLabel ?? "Открыть текущий инструмент"}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
