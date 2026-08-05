import type { Metadata } from "next";
import Link from "next/link";
import { WrongSectionMoveButton } from "@/components/admin/WrongSectionMoveButton";
import {
  listSectionRoutingMismatchesLive,
  loadSectionRoutingAuditFile,
} from "@/lib/admin/section-routing-audit";

export const metadata: Metadata = {
  title: "Карточка не в своём разделе — Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminWrongSectionPage() {
  const file = await loadSectionRoutingAuditFile();
  const live = await listSectionRoutingMismatchesLive(300);

  // Prefer live professionals scan; merge unique from file audit.
  const byId = new Map(live.map((m) => [m.entityId, m]));
  for (const m of file.mismatches) {
    if (!byId.has(m.entityId)) byId.set(m.entityId, m);
  }
  const mismatches = [...byId.values()];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-sm font-medium text-brand-blue-deep">Review Center</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          Карточка не в своём разделе
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Повторяемый hygiene-pass по live каталогу. Очередь разбора —{" "}
          <Link className="text-brand-blue hover:underline" href="/admin/review/inbox">
            полосы
          </Link>
          , рекомендации —{" "}
          <Link
            className="text-brand-blue hover:underline"
            href="/admin/community/recommendations"
          >
            сюда
          </Link>
          .
        </p>
        <p className="mt-2 text-slate-500">
          Расхождения между текущим разделом и подсказкой маршрутизатора. Автопереезда
          нет — только по подтверждению.{" "}
          {file.generatedAt ? (
            <>
              Файл аудита:{" "}
              <code className="text-xs">section_routing_audit_latest.json</code>{" "}
              ({file.generatedAt}).
            </>
          ) : (
            <>
              Запустите{" "}
              <code className="text-xs">
                python3 scripts/business-enrich/audit_section_routing.py
              </code>{" "}
              для полного отчёта.
            </>
          )}
        </p>
        <p className="mt-2 text-sm">
          <Link className="text-brand-blue hover:underline" href="/admin/review/views">
            ← Saved Views
          </Link>
        </p>
      </div>

      {mismatches.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-600">
          Расхождений не найдено (или аудит ещё не запускали).
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {mismatches.map((m) => (
            <li
              key={`${m.section}:${m.entityId}`}
              className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <Link
                  className="font-medium text-slate-900 hover:text-brand-blue"
                  href={m.path}
                >
                  {m.title || m.entityId}
                </Link>
                <p className="mt-0.5 text-sm text-slate-500">
                  {m.section} → предложено{" "}
                  <span className="font-medium text-slate-700">
                    {m.suggestedCollection}
                  </span>{" "}
                  · {m.reason} · {m.confidence}
                </p>
              </div>
              <WrongSectionMoveButton
                entityId={m.entityId}
                fromSection={m.section}
                reason={m.reason}
                suggestedEntityType={m.suggestedEntityType}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
