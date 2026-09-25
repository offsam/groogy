import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DurakTable } from "@/components/games/DurakTable";
import { loadDurakView, parseDurakTableId } from "@/lib/games/durak/store";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ table: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { table } = await params;
  const tableId = parseDurakTableId(table);
  return {
    title: tableId ? `Стол ${tableId} — Дурак — КРУГИ` : "Дурак — КРУГИ",
  };
}

export default async function DurakTablePage({ params }: PageProps) {
  const { table } = await params;
  const tableId = parseDurakTableId(table);
  if (!tableId) notFound();
  const view = await loadDurakView(tableId);
  return <DurakTable initial={view} tableId={tableId} />;
}
