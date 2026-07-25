import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminBusinessForm } from "@/components/admin/AdminBusinessForm";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import { getActiveCategories } from "@/lib/supabase/queries";

export const metadata: Metadata = {
  title: "Новый бизнес — Admin",
};

export default async function AdminNewBusinessPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/businesses/new");
  if (!(await userIsAdmin(supabase))) redirect("/");

  const categories = await getActiveCategories(supabase);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          className="text-sm text-slate-500 hover:text-slate-900"
          href="/admin/businesses"
        >
          ← К бизнесам
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
          Добавить бизнес
        </h1>
      </div>
      <AdminBusinessForm categories={categories} />
    </div>
  );
}
