import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TelegramNewImportsPanel } from "@/components/admin/TelegramNewImportsPanel";
import { listRecentTelegramImports } from "@/lib/admin/imports/telegram-new";
import { RECENT_IMPORT_DAYS } from "@/lib/admin/imports/recent-import";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Telegram · новое — Imports — Admin",
};

export const dynamic = "force-dynamic";

const BASE = "/admin/imports/telegram/new";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function AdminImportsTelegramNewPage({
  searchParams,
}: PageProps) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${BASE}`);
  if (!(await userIsAdmin(supabase))) redirect("/");

  const q = await searchParams;
  const daysRaw = Number(q.days || String(RECENT_IMPORT_DAYS));
  const days = Number.isFinite(daysRaw)
    ? Math.min(14, Math.max(1, Math.floor(daysRaw)))
    : RECENT_IMPORT_DAYS;
  const directorySource = q.source?.trim() || undefined;
  const page = Math.max(1, Number(q.page || "1") || 1);

  const { items, total, createdAfter } = await listRecentTelegramImports(
    supabase,
    {
      days,
      directorySource,
      page,
      pageSize: 100,
      status: "pending",
    },
  );

  return (
    <TelegramNewImportsPanel
      items={items}
      total={total}
      days={days}
      createdAfter={createdAfter}
    />
  );
}
