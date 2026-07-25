import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminBusinessesPanel } from "@/components/business/AdminBusinessesPanel";
import {
  findDuplicatePairs,
  getAdminBusinesses,
} from "@/lib/business/admin-queries";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";

export const metadata: Metadata = {
  title: "Бизнесы и дубликаты — Admin",
};

export default async function AdminBusinessesPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/businesses");
  }

  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    redirect("/");
  }

  let businesses: Awaited<ReturnType<typeof getAdminBusinesses>> = [];
  let loadError: string | null = null;

  try {
    businesses = await getAdminBusinesses(supabase);
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Не удалось загрузить бизнесы";
  }

  const pairs = findDuplicatePairs(businesses);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Бизнесы и дубликаты
        </h1>
        <p className="mt-2 text-slate-500">
          Предложения смержить карточки с одним телефоном или похожим именем.
          Merge переносит офферы, отзывы и владельцев, дубликат уходит в архив.
        </p>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-800">
          {loadError}
          <p className="mt-2 text-red-600">
            Если миграция admin merge ещё не применена — это ожидаемо.
          </p>
        </div>
      ) : (
        <AdminBusinessesPanel businesses={businesses} pairs={pairs} />
      )}
    </div>
  );
}
