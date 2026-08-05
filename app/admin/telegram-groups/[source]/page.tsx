import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ source: string }>;
};

/** Legacy Telegram source → Imports / Telegram / [source]. */
export default async function AdminTelegramSourceRedirect({ params }: PageProps) {
  const { source } = await params;
  redirect(`/admin/imports/telegram/${encodeURIComponent(source)}`);
}
