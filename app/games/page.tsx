import type { Metadata } from "next";
import { DurakTable } from "@/components/games/DurakTable";
import { loadDurakView } from "@/lib/games/durak/store";

export const metadata: Metadata = {
  title: "Игры — КРУГИ",
  description: "Совместные игры. Стол дурака.",
};

export const dynamic = "force-dynamic";

export default async function GamesPage() {
  const view = await loadDurakView();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Игры
        </h1>
        <p className="mt-1 text-sm text-slate-600">Совместные игры</p>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Игры">
        <span className="inline-flex min-h-11 items-center rounded-full bg-brand-blue px-4 text-sm font-semibold text-white">
          Дурак
        </span>
      </div>
      <DurakTable initial={view} />
    </div>
  );
}
