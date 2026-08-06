import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ExternalLink, Tag } from "lucide-react";
import { CouponComments } from "@/components/coupons/CouponComments";
import {
  getCommentsForCoupon,
  getPublishedCouponById,
} from "@/lib/coupons/queries";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const catalog = createServiceRoleClient();
  const coupon = await getPublishedCouponById(catalog, id).catch(() => null);
  if (!coupon) return { title: "Акция не найдена" };
  return {
    title: `${coupon.title} — Купонинг — КРУГИ`,
    description: coupon.body.slice(0, 160),
  };
}

export default async function CouponDetailPage({ params }: PageProps) {
  const { id } = await params;
  const catalog = createServiceRoleClient();
  const client = await createServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  const coupon = await getPublishedCouponById(catalog, id);
  if (!coupon) notFound();

  const comments = await getCommentsForCoupon(catalog, id);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-3 py-6 sm:px-6 sm:py-8">
      {coupon.imageUrl ? (
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl bg-slate-100">
          <Image
            alt={coupon.title}
            className="object-cover"
            fill
            sizes="(max-width: 768px) 100vw, 672px"
            src={coupon.imageUrl}
          />
        </div>
      ) : null}

      <div className="space-y-3">
        {coupon.categoryName ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-red/10 px-2 py-0.5 text-xs font-medium text-brand-red">
            <Tag aria-hidden="true" className="size-3" />
            {coupon.categoryName}
          </span>
        ) : null}
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-slate-900">
          {coupon.title}
        </h1>
        {coupon.curatorDisplayName ? (
          <p className="text-sm text-slate-500">
            От {coupon.curatorDisplayName}
          </p>
        ) : null}
        <p className="whitespace-pre-wrap text-slate-800">{coupon.body}</p>

        {coupon.linkUrl || coupon.promoCode ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            {coupon.promoCode ? (
              <span className="rounded-lg bg-white px-3 py-1.5 font-mono text-sm font-semibold text-slate-800 shadow-sm">
                {coupon.promoCode}
              </span>
            ) : null}
            {coupon.linkUrl ? (
              <a
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue/90"
                href={coupon.linkUrl}
                rel="noopener noreferrer nofollow"
                target="_blank"
              >
                Ссылка
                <ExternalLink aria-hidden="true" className="size-4" />
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      <hr className="border-slate-200" />

      <CouponComments comments={comments} couponId={coupon.id} isLoggedIn={!!user} />
    </div>
  );
}
