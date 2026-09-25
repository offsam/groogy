import type { Metadata } from "next";
import { CardFanMark, LobbyCircle, LobbyGrid } from "@/components/games/LobbyCircle";

export const metadata: Metadata = {
  title: "Игры — КРУГИ",
  description: "Совместные игры.",
};

export default function GamesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Игры
        </h1>
        <p className="mt-1 text-sm text-slate-600">Совместные игры</p>
      </div>
      <LobbyGrid>
        <LobbyCircle
          caption="Карточный стол"
          felt
          href="/games/durak"
          mark={<CardFanMark />}
          title="Дурак"
        />
        <LobbyCircle caption="Скоро" mark={<CardFanMark />} title="Преферанс" />
        <LobbyCircle caption="Скоро" mark={<CardFanMark />} title="Козёл" />
      </LobbyGrid>
    </div>
  );
}
