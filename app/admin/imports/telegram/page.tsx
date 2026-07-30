import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TelegramImportsIndex } from "@/components/admin/TelegramImportsIndex";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Telegram — Imports — Admin",
};

export const dynamic = "force-dynamic";

const BASE = "/admin/imports/telegram";

export default async function AdminImportsTelegramPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${BASE}`);
  if (!(await userIsAdmin(supabase))) redirect("/");

  return <TelegramImportsIndex basePath={BASE} />;
}
