import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TelegramImportsIndex } from "@/components/admin/TelegramImportsIndex";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Telegram — Imports — Admin",
};

export const dynamic = "force-dynamic";

/** Legacy URL — same UI as IA `/admin/imports/telegram`. */
export default async function AdminTelegramGroupsIndexPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/telegram-groups");
  if (!(await userIsAdmin(supabase))) redirect("/");

  return (
    <TelegramImportsIndex
      basePath="/admin/telegram-groups"
      showLegacyBanner
    />
  );
}
