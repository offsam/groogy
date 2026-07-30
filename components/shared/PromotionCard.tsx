import Link from "next/link";
import { Percent } from "lucide-react";
import type { EntityPromotion } from "@/types/promotion";

function formatWindow(from: string | null, until: string | null): string | null {
  if (!from && !until) return null;
  try {
    const fmt = (iso: string) =>
      new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "short",
      }).format(new Date(`${iso}T12:00:00Z`));
    if (from && until) return `${fmt(from)} — ${fmt(until)}`;
    if (until) return `до ${fmt(until)}`;
    return `с ${fmt(from!)}`;
  } catch {
    return null;
  }
}

export function PromotionCard({
  promo,
  showOwner = false,
}: {
  promo: EntityPromotion;
  showOwner?: boolean;
}) {
  const windowLabel = formatWindow(promo.validFrom, promo.validUntil);
  return (
    <article className="rounded-2xl border border-rose-200/80 bg-rose-50/50 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="inline-flex items-start gap-1.5 text-base font-semibold text-slate-900">
          <Percent
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-rose-600"
          />
          <span>{promo.title}</span>
        </h3>
        {promo.discountLabel ? (
          <span className="shrink-0 rounded-full bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white">
            {promo.discountLabel}
          </span>
        ) : null}
      </div>
      {promo.body ? (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
          {promo.body}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        {windowLabel ? <span>{windowLabel}</span> : null}
        {promo.categoryName ? <span>{promo.categoryName}</span> : null}
        {showOwner && promo.ownerHref && promo.ownerName ? (
          <Link
            href={promo.ownerHref}
            className="font-medium text-brand-blue hover:underline"
          >
            {promo.ownerName}
          </Link>
        ) : null}
      </div>
    </article>
  );
}

/** Profile section — hidden entirely when there are no active promotions. */
export function PromotionsSection({
  promotions,
  title = "Акции",
}: {
  promotions: EntityPromotion[];
  title?: string;
}) {
  if (!promotions.length) return null;
  return (
    <section className="space-y-3" aria-label={title}>
      <h2 className="inline-flex items-center gap-1.5 text-base font-semibold text-slate-900">
        <Percent aria-hidden="true" className="size-4 text-rose-600" />
        {title}
      </h2>
      <div className="space-y-3">
        {promotions.map((promo) => (
          <PromotionCard key={promo.id} promo={promo} />
        ))}
      </div>
    </section>
  );
}
