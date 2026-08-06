import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { CouponCard } from "@/components/coupons/CouponCard";
import { EmptyState } from "@/components/ui/DataState";
import { getPublishedCoupons, getCouponCategories } from "@/lib/coupons/queries";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const metadata: Metadata = {
  title: "Купонинг — скидки и акции — КРУГИ",
  description: "Акции, спецпредложения и промокоды от своих — по всей стране",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ category?: string }>;
};

export default async function CouponsPage({ searchParams }: PageProps) {
  const { category } = await searchParams;
  const catalog = createServiceRoleClient();

  const [coupons, categories] = await Promise.all([
    getPublishedCoupons(catalog, { categoryId: category || null, limit: 90 }),
    getCouponCategories().catch(() => []),
  ]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-3 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Купонинг
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Скидки, акции и промокоды от своих — по всей стране
            {coupons.length > 0 ? ` · ${coupons.length}` : null}
          </p>
        </div>
        <Link
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-brand-blue/40"
          href="/coupons/submit"
        >
          <Plus aria-hidden="true" className="size-4" />
          Предложить акцию
        </Link>
      </div>

      {categories.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <Link
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
              !category
                ? "border-brand-blue bg-brand-blue text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
            }`}
            href="/coupons"
          >
            Все
          </Link>
          {categories.map((c) => (
            <Link
              key={c.id}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                category === c.id
                  ? "border-brand-blue bg-brand-blue text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
              }`}
              href={`/coupons?category=${c.id}`}
            >
              {c.name}
            </Link>
          ))}
        </div>
      ) : null}

      {coupons.length === 0 ? (
        <EmptyState
          title="Пока нет акций"
          description="Здесь появятся скидки и акции, как только куратор их опубликует."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {coupons.map((coupon) => (
            <CouponCard key={coupon.id} coupon={coupon} />
          ))}
        </ul>
      )}
    </div>
  );
}
