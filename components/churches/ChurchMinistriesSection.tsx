import { Church } from "lucide-react";
import type { ChurchMinistry } from "@/types/church";

type ChurchMinistriesSectionProps = {
  ministries: ChurchMinistry[];
};

export function ChurchMinistriesSection({
  ministries,
}: ChurchMinistriesSectionProps) {
  const items = ministries.filter((m) => m.title.trim());
  if (items.length === 0) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
        <Church aria-hidden className="size-4 text-slate-400" />
        Служения
      </h2>
      <ul className="mt-3 space-y-2">
        {items.map((item) => {
          const body = (
            <>
              <p className="text-sm font-medium text-slate-900">{item.title}</p>
              {item.detail ? (
                <p className="mt-0.5 text-sm text-slate-600">{item.detail}</p>
              ) : null}
            </>
          );
          return (
            <li
              key={`${item.title}-${item.url ?? ""}`}
              className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5"
            >
              {item.url ? (
                <a
                  className="block transition-colors hover:text-brand-blue"
                  href={item.url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {body}
                </a>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
