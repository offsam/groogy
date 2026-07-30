import type { ImportSourceStats } from "@/lib/admin/imports/types";
import { IMPORT_STATUS_LABELS } from "@/lib/admin/imports/types";

type Props = {
  stats: ImportSourceStats;
  className?: string;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const CELLS: Array<{
  key: keyof Pick<
    ImportSourceStats,
    "imported" | "inReview" | "approved" | "rejected" | "error"
  >;
  label: string;
}> = [
  { key: "imported", label: "Imported" },
  { key: "inReview", label: "In Review" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "error", label: "Error" },
];

export function ImportSourceStatsCard({ stats, className }: Props) {
  return (
    <div
      className={
        className ??
        "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Сводка источника</h2>
        <p className="text-xs text-slate-500">
          Статус:{" "}
          <span className="font-medium text-slate-800">
            {IMPORT_STATUS_LABELS[stats.importStatus]}
          </span>
          {" · "}
          Активность: {formatDate(stats.lastActivityAt)}
        </p>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {CELLS.map((cell) => (
          <div
            key={cell.key}
            className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"
          >
            <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {cell.label}
            </dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
              {stats[cell.key]}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
