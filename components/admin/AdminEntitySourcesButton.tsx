"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Layers, X } from "lucide-react";
import {
  listEntityMergeSourcesAction,
  type EntitySourceHit,
  type EntitySourceKind,
} from "@/lib/admin/entity-merge-sources";
import type { LiveEntityKind } from "@/lib/admin/published-duplicates-scan";
import { cn } from "@/lib/utils";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

const chip =
  "inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50";

type Props = {
  kind: LiveEntityKind;
  entityId: string;
  className?: string;
};

function kindLabel(kind: EntitySourceKind): string {
  if (kind === "import") return "импорт";
  if (kind === "import_duplicate") return "копия";
  if (kind === "recommendation") return "рекомендация";
  if (kind === "mention") return "упоминание";
  return "профиль";
}

function countByKind(sources: EntitySourceHit[]) {
  const counts = {
    import: 0,
    import_duplicate: 0,
    recommendation: 0,
    mention: 0,
    profile: 0,
  };
  for (const s of sources) counts[s.kind] += 1;
  return counts;
}

export function AdminEntitySourcesButton({
  kind,
  entityId,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selfName, setSelfName] = useState<string | null>(null);
  const [sources, setSources] = useState<EntitySourceHit[]>([]);

  function run() {
    setOpen(true);
    setError(null);
    setSources([]);
    setSelfName(null);
    startTransition(async () => {
      try {
        const res = await listEntityMergeSourcesAction({
          entityType: kind,
          entityId,
        });
        if (!res.ok) {
          setError(res.message);
          return;
        }
        setSelfName(res.selfName);
        setSources(res.sources);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Не удалось загрузить источники",
        );
      }
    });
  }

  const counts = countByKind(sources);

  return (
    <div className={cn("relative", className)}>
      <button type="button" className={chip} onClick={run} disabled={pending}>
        {pending && open ? (
          <BrandPinLoader size="sm" />
        ) : (
          <Layers className="size-3.5" />
        )}
        Из чего собрана
      </button>

      {open ? (
        <div className="absolute left-0 z-40 mt-2 w-[min(100vw-2rem,24rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-lg sm:left-auto sm:right-0">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-900">
                Источники «{selfName || "…"}»
              </p>
              {!pending && sources.length > 0 ? (
                <p className="mt-0.5 text-[11px] text-slate-500">
                  импорт: {counts.import}
                  {counts.import_duplicate
                    ? ` · копий: ${counts.import_duplicate}`
                    : ""}
                  {counts.recommendation
                    ? ` · рекомендаций: ${counts.recommendation}`
                    : ""}
                  {counts.mention ? ` · упоминаний: ${counts.mention}` : ""}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              onClick={() => setOpen(false)}
              aria-label="Закрыть"
            >
              <X className="size-4" />
            </button>
          </div>

          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
              {error}
            </p>
          ) : null}

          {pending ? (
            <p className="text-xs text-slate-500">Собираю источники…</p>
          ) : null}

          {!pending && !error && sources.length === 0 ? (
            <p className="text-xs text-slate-500">
              Пока нет связанных импортов и рекомендаций в истории.
            </p>
          ) : null}

          {!pending && sources.length > 0 ? (
            <ul className="max-h-80 space-y-2 overflow-y-auto text-xs">
              {sources.map((s) => (
                <li
                  key={`${s.kind}-${s.id}`}
                  className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                      {kindLabel(s.kind)}
                    </span>
                    {s.status ? (
                      <span className="text-[10px] text-slate-400">
                        {s.status}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 font-medium text-slate-900">
                    {s.title}
                  </p>
                  {s.reason ? (
                    <p className="mt-0.5 text-slate-500">{s.reason}</p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap gap-2">
                    {s.href ? (
                      <Link
                        href={s.href}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-brand-blue hover:underline"
                      >
                        Открыть
                      </Link>
                    ) : null}
                    {s.sourceUrl ? (
                      <a
                        href={s.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-brand-blue hover:underline"
                      >
                        Источник
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
