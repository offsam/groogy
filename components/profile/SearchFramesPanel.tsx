"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { X } from "lucide-react";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { ServiceCard } from "@/components/services/ServiceCard";
import { dismissSearchHistoryAction } from "@/lib/profile/search-history-actions";
import type { SearchFrameWithListings } from "@/lib/profile/search-history-queries";

type Props = {
  frames: SearchFrameWithListings[];
};

export function SearchFramesPanel({ frames }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function dismiss(id: string, queryNormalized: string) {
    startTransition(async () => {
      await dismissSearchHistoryAction(id, queryNormalized);
      router.refresh();
    });
  }

  if (frames.length === 0) {
    return (
      <aside className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Ваши поиски</h2>
        <p className="text-sm text-slate-500">
          Здесь появятся подборки по вашим запросам в поиске.
        </p>
      </aside>
    );
  }

  return (
    <aside className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Ваши поиски</h2>
      <div className="space-y-4">
        {frames.map((frame) => (
          <article
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
            key={frame.id}
          >
            <div className="border-b border-slate-100 px-3 py-2.5">
              <p className="truncate text-sm font-semibold text-slate-900">
                «{frame.query}»
              </p>
              <p className="text-[11px] text-slate-400">искали недавно</p>
            </div>

            <div className="max-h-72 space-y-3 overflow-y-auto px-3 py-3">
              {frame.listings.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Пока нет подходящих объявлений.
                </p>
              ) : (
                frame.listings.map((listing) =>
                  listing.listingType === "service" ? (
                    <ServiceCard key={listing.id} listing={listing} />
                  ) : (
                    <ListingCard key={listing.id} listing={listing} />
                  ),
                )
              )}
            </div>

            <div className="flex items-center border-t border-slate-100 bg-slate-50 px-2 py-1">
              <button
                aria-label="Не актуально"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-slate-500 hover:bg-white hover:text-slate-800"
                disabled={pending}
                onClick={() => dismiss(frame.id, frame.queryNormalized)}
                title="Не актуально"
                type="button"
              >
                <X className="size-4" />
                Не актуально
              </button>
            </div>
          </article>
        ))}
      </div>
    </aside>
  );
}
