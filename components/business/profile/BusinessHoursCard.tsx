import { Clock } from "lucide-react";
import {
  dayLabelRu,
  formatDayHoursLabel,
  openingHoursRows,
  type OpeningHours,
} from "@/lib/business/opening-hours";

type BusinessHoursCardProps = {
  hours: OpeningHours;
};

export function BusinessHoursCard({ hours }: BusinessHoursCardProps) {
  const rows = openingHoursRows(hours);
  const today = new Date().getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
        <Clock aria-hidden="true" className="size-4 text-slate-400" />
        Часы работы
      </h2>
      <ul className="mt-3 space-y-1.5 text-sm">
        {rows.map((row) => {
          const isToday = row.day === today;
          const closed = row.closed || !row.open || !row.close;
          return (
            <li
              key={row.day}
              className={`flex items-baseline justify-between gap-3 ${
                isToday ? "font-semibold text-slate-900" : "text-slate-600"
              }`}
            >
              <span className="min-w-0 truncate">
                {dayLabelRu(row.day)}
                {isToday ? (
                  <span className="ml-1.5 text-[11px] font-medium text-brand-green">
                    сегодня
                  </span>
                ) : null}
              </span>
              <span
                className={`shrink-0 tabular-nums ${
                  closed ? "text-slate-400" : ""
                }`}
              >
                {formatDayHoursLabel(row)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
