import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminChurchForm } from "@/components/admin/AdminChurchForm";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Новая церковь — Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminNewChurchPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/catalog/churches/new");
  if (!(await userIsAdmin(supabase))) redirect("/");

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Новая церковь
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Описание без контактов; телефон, источник и адрес — в отдельных
          полях.
        </p>
      </div>
      <AdminChurchForm />
    </div>
  );
}
