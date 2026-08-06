import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminBloggerDirectoryPanel } from "@/components/admin/AdminBloggerDirectoryPanel";
import { listBloggerDirectoryAction } from "@/lib/admin/blogger-directory";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Картотека блогеров — Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminBloggerDirectoryPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/blogger-directory");
  }
  if (!(await userIsAdmin(supabase))) redirect("/");

  const result = await listBloggerDirectoryAction();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-sm font-medium text-brand-blue-deep">System</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          Картотека блогеров
        </h1>
        <p className="mt-2 max-w-2xl text-slate-500">
          Русскоязычные блогеры/каналы, живущие в США или делающие контент
          про США — Facebook, Instagram, YouTube, TikTok, Telegram. Список
          собирается и растёт постепенно, категории пока рабочие — точную
          разбивку и оформление под пользователей на платформе сделаем
          позже.
        </p>
      </div>

      {!result.ok ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-800">
          {result.message}
        </div>
      ) : (
        <AdminBloggerDirectoryPanel bloggers={result.bloggers} />
      )}
    </div>
  );
}
