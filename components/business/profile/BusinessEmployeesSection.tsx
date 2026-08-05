import Image from "next/image";
import Link from "next/link";
import { UserRound } from "lucide-react";
import type { BusinessEmployeeTeaser } from "@/lib/business/employees";

type Props = {
  employees: BusinessEmployeeTeaser[];
};

export function BusinessEmployeesSection({ employees }: Props) {
  if (!employees.length) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">Сотрудники</h2>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {employees.map((emp) => {
          const subtitle =
            emp.employerRole?.trim() ||
            emp.headline?.trim() ||
            emp.city?.trim() ||
            null;
          return (
            <li key={emp.id}>
              <Link
                href={`/professional/${emp.slug}`}
                className="flex min-h-14 items-center gap-3 px-3 py-2.5 hover:bg-slate-50"
              >
                <div className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-slate-500 ring-1 ring-black/5">
                  {emp.imageUrl && emp.imageUrl !== "/placeholder.svg" ? (
                    <Image
                      alt=""
                      className="object-cover"
                      fill
                      sizes="44px"
                      src={emp.imageUrl}
                      unoptimized
                    />
                  ) : (
                    <UserRound aria-hidden className="size-5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">
                    {emp.displayName}
                  </p>
                  {subtitle ? (
                    <p className="truncate text-xs text-slate-500">{subtitle}</p>
                  ) : null}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
