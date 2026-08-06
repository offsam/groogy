import Image from "next/image";
import Link from "next/link";
import { Tag, ExternalLink } from "lucide-react";
import type { Coupon } from "@/types/coupon";

export function CouponCard({ coupon }: { coupon: Coupon }) {
  return (
    <li className="overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:border-brand-blue/40 hover:shadow-sm">
      <Link className="block" href={`/coupons/${coupon.id}`}>
        {coupon.imageUrl ? (
          <div className="relative aspect-[4/3] w-full bg-slate-100">
            <Image
              alt={coupon.title}
              className="object-cover"
              fill
              sizes="(max-width: 640px) 100vw, 320px"
              src={coupon.imageUrl}
            />
          </div>
        ) : null}
        <div className="space-y-2 p-4">
          {coupon.categoryName ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-red/10 px-2 py-0.5 text-xs font-medium text-brand-red">
              <Tag aria-hidden="true" className="size-3" />
              {coupon.categoryName}
            </span>
          ) : null}
          <h3 className="line-clamp-2 font-semibold text-slate-900">
            {coupon.title}
          </h3>
          <p className="line-clamp-3 text-sm text-slate-600">{coupon.body}</p>
        </div>
      </Link>
      {coupon.linkUrl || coupon.promoCode ? (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
          {coupon.promoCode ? (
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-mono font-semibold text-slate-700">
              {coupon.promoCode}
            </span>
          ) : null}
          {coupon.linkUrl ? (
            <a
              className="ml-auto inline-flex items-center gap-1 rounded-lg bg-brand-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-blue/90"
              href={coupon.linkUrl}
              rel="noopener noreferrer nofollow"
              target="_blank"
            >
              Ссылка
              <ExternalLink aria-hidden="true" className="size-3" />
            </a>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
