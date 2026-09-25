import type { Metadata } from "next";
import Link from "next/link";
import { LobbyCircle, LobbyGrid } from "@/components/games/LobbyCircle";
import { listDurakTables } from "@/lib/games/durak/store";

export const metadata: Metadata = {
  title: "Дурак — КРУГИ",
  description: "Столы дурака.",
};

export const dynamic = "force-dynamic";

function seatedCaption(count: number): string {
  if (count <= 0) return "свободен";
  return `${count} за столом`;
}

export default async function DurakLobbyPage() {
  const tables = await listDurakTables();

  return (
    <div className="space-y-6">
      <div>
        <Link className="text-sm font-medium text-brand-blue" href="/games">
          Игры
        </Link>
        <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Дурак
        </h1>
        <p className="mt-1 text-sm text-slate-600">Выберите стол</p>
      </div>
      <LobbyGrid>
        {tables.map((table) => (
          <LobbyCircle
            caption={seatedCaption(table.seated)}
            felt
            href={`/games/durak/${table.id}`}
            key={table.id}
            mark={
              <span className="font-[family-name:var(--font-display)] text-3xl font-semibold text-white sm:text-4xl">
                {table.id}
              </span>
            }
            title={`Стол ${table.id}`}
          />
        ))}
      </LobbyGrid>
    </div>
  );
}
