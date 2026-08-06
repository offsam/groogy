import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SubmitCouponForm } from "@/components/coupons/SubmitCouponForm";
import { createServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Предложить акцию — Купонинг — КРУГИ",
};

export const dynamic = "force-dynamic";

export default async function SubmitCouponPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/coupons/submit");
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 px-3 py-6 sm:px-6 sm:py-8">
      <div>
        <Link className="text-sm text-brand-blue hover:underline" href="/coupons">
          ← Купонинг
        </Link>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-slate-900">
          Предложить акцию
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Нашли скидку или спецпредложение? Пришлите сюда — куратор посмотрит
          и опубликует, если подходит.
        </p>
      </div>
      <SubmitCouponForm />
    </div>
  );
}
