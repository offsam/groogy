import type { Metadata } from "next";
import Link from "next/link";
import { WrongSectionMoveButton } from "@/components/admin/WrongSectionMoveButton";
import {
  listBusinessProfessionalCandidatesLive,
  REASON_LABEL,
} from "@/lib/admin/business-to-professional-candidates";

export const metadata: Metadata = {
  title: "Бизнесы, похожие на специалистов — Admin",
};

export const dynamic = "force-dynamic";

const CONFIDENCE_LABEL: Record<"high" | "medium", string> = {
  high: "высокая",
  medium: "средняя",
};

export default async function AdminBusinessToProfessionalPage() {
  const candidates = await listBusinessProfessionalCandidatesLive(500);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-sm font-medium text-brand-blue-deep">Review Center</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          Бизнесы, похожие на специалистов
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Карточки в разделе «Бизнесы», у которых название выглядит как имя
          человека, а не компании (напр. «Ирина Крук», «Larisa, Nail Master») —
          кандидаты на перенос в «Специалисты». Совпадение по имени — эвристика,
          не 100% точная, поэтому это очередь на ручное подтверждение, а не
          автоперенос: жмите «Перенести → professionals» только там, где
          согласны.
        </p>
        <p className="mt-2 text-sm">
          <Link
            className="text-brand-blue hover:underline"
            href="/admin/review/wrong-section"
          >
            ← Карточка не в своём разделе
          </Link>
        </p>
      </div>

      {candidates.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-600">
          Кандидатов не найдено.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {candidates.map((c) => (
            <li
              key={c.entityId}
              className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <Link
                  className="font-medium text-slate-900 hover:text-brand-blue"
                  href={c.path}
                >
                  {c.name}
                </Link>
                <p className="mt-0.5 text-sm text-slate-500">
                  {[c.city, c.stateCode].filter(Boolean).join(", ") || "—"}
                  {c.categoryName ? ` · ${c.categoryName}` : ""} ·{" "}
                  {REASON_LABEL[c.matchReason]} · уверенность{" "}
                  {CONFIDENCE_LABEL[c.confidence]}
                </p>
              </div>
              <WrongSectionMoveButton
                entityId={c.entityId}
                fromSection="businesses"
                reason={`biz_to_pro_candidate:${c.matchReason}`}
                suggestedEntityType="private_specialist"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
