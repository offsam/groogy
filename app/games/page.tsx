import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/DataState";

export const metadata: Metadata = {
  title: "Игры — КРУГИ",
  description: "Совместные игры",
};

export default function GamesPage() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-3 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Игры
        </h1>
        <p className="mt-1 text-sm text-slate-600">Совместные игры</p>
      </div>
      <EmptyState
        description="В этом разделе пока нет карточек."
        title="Пока пусто"
      />
    </div>
  );
}
