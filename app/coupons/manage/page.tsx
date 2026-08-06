import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CuratorManagePanel } from "@/components/coupons/CuratorManagePanel";
import { isCouponCurator } from "@/lib/coupons/curator";
import {
  getCouponCategories,
  getCouponsByCurator,
  getPendingSubmissions,
} from "@/lib/coupons/queries";
import { userIsAdmin } from "@/lib/reviews/queries";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Купонинг — мой кабинет",
};

export const dynamic = "force-dynamic";

export default async function CouponManagePage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/coupons/manage");
  }

  const [curator, admin] = await Promise.all([
    isCouponCurator(supabase),
    userIsAdmin(supabase).catch(() => false),
  ]);
  if (!curator && !admin) {
    redirect("/coupons");
  }

  const [submissions, myCoupons, categories] = await Promise.all([
    getPendingSubmissions(),
    getCouponsByCurator(user.id),
    getCouponCategories().catch(() => []),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-3 py-6 sm:px-6 sm:py-8">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-slate-900">
          Купонинг — мой кабинет
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Публикуйте посты напрямую и разбирайте предложения от пользователей.
        </p>
      </div>
      <CuratorManagePanel
        categories={categories}
        myCoupons={myCoupons}
        submissions={submissions}
      />
    </div>
  );
}
