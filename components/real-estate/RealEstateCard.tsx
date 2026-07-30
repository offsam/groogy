import Image from "next/image";
import Link from "next/link";
import { Building2, MapPin } from "lucide-react";
import {
  CategoryAccentBar,
  CategoryChip,
  CategoryMediaFallback,
} from "@/components/platform/CategoryCardChrome";
import { PaymentMethodIcons } from "@/components/shared/PaymentMethodIcons";

export type RealEstateCardItem = {
  id: string;
  title: string;
  slug: string;
  city: string | null;
  /** Optional — present when schema/query expands */
  priceAmount?: number | null;
  priceCurrency?: string | null;
  offerKind?: "sell" | "rent" | null;
  coverUrl?: string | null;
  paymentMethods?: string[] | null;
};

function formatPrice(
  amount: number | null | undefined,
  currency: string | null | undefined,
  offerKind: "sell" | "rent" | null | undefined,
) {
  if (amount == null) return null;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(amount);
  if (offerKind === "rent") return `${formatted}/мес`;
  return formatted;
}

const OFFER_LABELS: Record<"sell" | "rent", string> = {
  sell: "Продажа",
  rent: "Аренда",
};

export function RealEstateCard({
  item,
  preview = false,
}: {
  item: RealEstateCardItem;
  preview?: boolean;
}) {
  const href = `/real-estate/${item.slug}`;
  const priceLabel = formatPrice(
    item.priceAmount,
    item.priceCurrency,
    item.offerKind,
  );

  const body = (
    <>
      <CategoryAccentBar theme="real_estate" />
      <div className="relative aspect-[4/3] bg-slate-100">
        {item.coverUrl ? (
          <Image
            alt=""
            className="object-cover"
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            src={item.coverUrl}
            unoptimized
          />
        ) : (
          <CategoryMediaFallback icon={Building2} theme="real_estate" />
        )}
      </div>
      <div className="space-y-2 p-4">
        <div className="flex flex-wrap gap-1.5">
          <CategoryChip theme="real_estate" />
          {item.offerKind ? (
            <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
              {OFFER_LABELS[item.offerKind]}
            </span>
          ) : null}
        </div>
        <p className="line-clamp-2 font-semibold text-slate-900">{item.title}</p>
        {priceLabel ? (
          <p className="text-lg font-bold text-slate-900">{priceLabel}</p>
        ) : null}
        {item.paymentMethods?.length ? (
          <PaymentMethodIcons methods={item.paymentMethods} size="sm" />
        ) : null}
        {item.city ? (
          <p className="flex items-center gap-1 text-sm text-slate-600">
            <MapPin
              aria-hidden
              className="size-3.5 shrink-0 text-slate-400"
            />
            {item.city}
          </p>
        ) : null}
      </div>
    </>
  );

  if (preview) {
    return (
      <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {body}
      </article>
    );
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white transition-shadow hover:shadow-md">
      <Link className="block" href={href}>
        {body}
      </Link>
    </article>
  );
}
