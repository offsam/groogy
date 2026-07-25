"use client";

import { useTransition } from "react";
import Link from "next/link";
import type { BusinessOffer } from "@/types/business-offer";
import {
  OFFER_STATUS_LABELS,
  OFFER_TYPE_SINGULAR,
} from "@/types/business-offer";
import { formatOfferPrice } from "@/lib/business-offers/mappers";
import {
  deleteBusinessOfferAction,
  setBusinessOfferStatusAction,
} from "@/lib/business-offers/actions";

type OfferManageListProps = {
  offers: BusinessOffer[];
  businessId: string;
  businessSlug: string;
};

export function OfferManageList({
  offers,
  businessId,
  businessSlug,
}: OfferManageListProps) {
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok && result.message) {
        alert(result.message);
      }
    });
  }

  if (offers.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 px-6 py-10 text-center text-sm text-slate-500">
        Пока нет предложений. Создайте первое.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
      {offers.map((offer) => (
        <li key={offer.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {OFFER_TYPE_SINGULAR[offer.offerType]} · {OFFER_STATUS_LABELS[offer.status]}
            </p>
            <h3 className="truncate font-semibold text-slate-900">{offer.title}</h3>
            <p className="text-sm text-slate-600">{formatOfferPrice(offer)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium"
              href={`/business/${businessSlug}/manage/offers/${offer.id}/edit`}
            >
              Изменить
            </Link>
            {offer.status !== "active" && (
              <button
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    setBusinessOfferStatusAction(
                      offer.id,
                      businessId,
                      businessSlug,
                      "active",
                      offer.slug,
                    ),
                  )
                }
                type="button"
              >
                Опубликовать
              </button>
            )}
            {offer.status === "active" && (
              <button
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium disabled:opacity-60"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    setBusinessOfferStatusAction(
                      offer.id,
                      businessId,
                      businessSlug,
                      "draft",
                      offer.slug,
                    ),
                  )
                }
                type="button"
              >
                Снять
              </button>
            )}
            <button
              className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-60"
              disabled={pending}
              onClick={() => {
                if (!confirm("Удалить предложение?")) return;
                run(() =>
                  deleteBusinessOfferAction(offer.id, businessId, businessSlug),
                );
              }}
              type="button"
            >
              Удалить
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
