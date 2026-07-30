import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TelegramImportSourceView } from "@/components/admin/TelegramImportSourceView";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import { telegramSourceBySlug } from "@/lib/import-review/telegram-sources";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ source: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ source: string }>;
}): Promise<Metadata> {
  const { source: slug } = await params;
  const meta = telegramSourceBySlug(slug);
  return {
    title: meta ? `${meta.title} — Imports — Admin` : "Telegram — Admin",
  };
}

/** Legacy URL — same UI as IA imports telegram source. */
export default async function AdminTelegramSourcePage({
  params,
  searchParams,
}: PageProps) {
  const { source: slug } = await params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/admin/telegram-groups/${slug}`);
  if (!(await userIsAdmin(supabase))) redirect("/");

  const q = await searchParams;
  const page = Math.max(1, Number(q.page || "1") || 1);

  return (
    <TelegramImportSourceView
      slug={slug}
      page={page}
      basePath="/admin/telegram-groups"
      showLegacyBanner
    />
  );
}
