"use client";

import Link from "next/link";
import { ServiceCard } from "@/components/services/ServiceCard";
import { TouchScrollRow } from "@/components/profile/TouchScrollRow";
import type { Listing } from "@/types/listing";

type Props = {
  services: Listing[];
  title?: string;
  showStatus?: boolean;
  allHref?: string | null;
};

/**
 * Mobile: frame + swipe, 3 cards across.
 * sm+: 4-column grid — same layout as MyListingsFrame.
 */
export function MyServicesFrame({
  services,
  title = "Услуги",
  showStatus = false,
  allHref = null,
}: Props) {
  if (services.length === 0) return null;

  return (
    <section className="min-w-0 space-y-3">
      <div className="hidden items-baseline justify-between gap-2 sm:flex">
        <h2 className="text-lg font-semibold text-slate-900">
          {title}
          <span className="ml-2 text-sm font-normal tabular-nums text-slate-500">
            {services.length}
          </span>
        </h2>
        {allHref ? (
          <Link
            className="text-sm font-medium text-brand-blue hover:underline"
            href={allHref}
          >
            Все
          </Link>
        ) : null}
      </div>

      <article className="@container min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:hidden">
        <div className="border-b border-slate-100 px-3 py-2.5">
          <p className="truncate text-sm font-semibold text-slate-900">
            {title}
          </p>
          <p className="text-[11px] tabular-nums text-slate-400">
            {services.length}{" "}
            {services.length === 1
              ? "услуга"
              : services.length < 5
                ? "услуги"
                : "услуг"}
          </p>
        </div>
        <div className="min-w-0 py-2">
          <TouchScrollRow>
            {services.map((listing) => (
              <div
                className="w-[calc((100cqi-3rem)/3)] shrink-0 snap-start"
                key={listing.id}
              >
                <ServiceCard
                  compact
                  listing={listing}
                  showStatus={showStatus}
                />
              </div>
            ))}
          </TouchScrollRow>
        </div>
        {allHref ? (
          <div className="border-t border-slate-100 bg-slate-50 px-3 py-1">
            <Link
              className="inline-flex min-h-11 items-center text-xs font-medium text-brand-blue"
              href={allHref}
            >
              Все услуги
            </Link>
          </div>
        ) : null}
      </article>

      <div className="hidden gap-3 sm:grid sm:grid-cols-4">
        {services.map((listing) => (
          <ServiceCard
            compact
            key={listing.id}
            listing={listing}
            showStatus={showStatus}
          />
        ))}
      </div>
    </section>
  );
}
