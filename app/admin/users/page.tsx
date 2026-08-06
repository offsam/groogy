import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminUsersPanel } from "@/components/admin/AdminUsersPanel";
import { getAdminUsers } from "@/lib/admin/queries";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Админы и пользователи — Admin",
};

export default async function AdminUsersPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/users");
  }

  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    redirect("/");
  }

  let users: Awaited<ReturnType<typeof getAdminUsers>> = [];
  let loadError: string | null = null;
  try {
    users = await getAdminUsers(supabase);
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Не удалось загрузить";
  }

  let couponCuratorIds: string[] = [];
  try {
    const catalog = createServiceRoleClient();
    const { data } = await catalog.from("coupon_curators").select("profile_id");
    couponCuratorIds = (data ?? []).map((r) => r.profile_id);
  } catch {
    couponCuratorIds = [];
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Админы и пользователи
        </h1>
        <p className="mt-2 text-slate-500">
          Назначьте или снимите роль администратора, или права куратора
          раздела «Купонинг». Нельзя снять права у себя и нельзя удалить
          последнего админа.
        </p>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-800">
          {loadError}
        </div>
      ) : (
        <AdminUsersPanel
          couponCuratorIds={couponCuratorIds}
          currentUserId={user.id}
          users={users}
        />
      )}
    </div>
  );
}
