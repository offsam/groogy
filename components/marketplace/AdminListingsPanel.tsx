"use client";

import { useTransition, useState } from "react";
import Link from "next/link";

import {
  adminSetListingReportStatusAction,
  adminSetListingStatusAction,
} from "@/lib/listings/actions";
import type { AdminListingRow } from "@/lib/listings/queries";
import { formatPrice } from "@/lib/listings/mappers";
import { AuthAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import {
  LISTING_STATUS_LABELS,
  REPORT_REASON_LABELS,
  type ListingReportReason,
} from "@/types/listing";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

const FILTERS = [
  { id: "all", label: "Все" },
  { id: "active", label: "Активные" },
  { id: "reported", label: "Жалобы" },
  { id: "removed", label: "Удалённые" },
  { id: "rejected", label: "Отклонённые" },
  { id: "completed", label: "Завершённые" },
  { id: "paused", label: "На паузе" },
] as const;

const DOMAIN_FILTERS = [
  { id: "all", label: "Все разделы" },
  { id: "marketplace", label: "Marketplace" },
  { id: "services", label: "Услуги" },
] as const;

type ReportRow = {
  id: string;
  listing_id: string;
  reason: ListingReportReason;
  details: string | null;
  status: string;
  created_at: string;
};

type AdminListingsPanelProps = {
  filter: string;
  domain: string;
  listings: AdminListingRow[];
  reportsByListingId: Record<string, ReportRow[]>;
  searchQuery: string;
};

export function AdminListingsPanel({
  filter,
  domain,
  listings,
  reportsByListingId,
  searchQuery,
}: AdminListingsPanelProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function run(
    action: () => Promise<{ ok: boolean; message?: string }>,
    successFallback: string,
  ) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.message ?? "Ошибка");
      else setMessage(result.message ?? successFallback);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {DOMAIN_FILTERS.map((d) => (
          <Link
            key={d.id}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              domain === d.id
                ? "bg-brand-blue-deep text-white"
                : "bg-brand-blue/5 text-brand-blue-deep hover:bg-brand-blue/10"
            }`}
            href={`/admin/listings?domain=${d.id}&filter=${filter}${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""}`}
            style={domain === d.id ? { color: "#ffffff" } : undefined}
          >
            {d.label}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.id}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              filter === f.id
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
            href={`/admin/listings?domain=${domain}&filter=${f.id}${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""}`}
            style={filter === f.id ? { color: "#ffffff" } : undefined}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <form action="/admin/listings" className="flex flex-wrap gap-2" method="get">
        <input type="hidden" name="filter" value={filter} />
        <input type="hidden" name="domain" value={domain} />
        <input
          className="min-w-[200px] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
          defaultValue={searchQuery}
          name="q"
          placeholder="Поиск по заголовку…"
          type="search"
        />
        <Button type="submit">Найти</Button>
      </form>

      {error && <AuthAlert>{error}</AuthAlert>}
      {message && <AuthAlert tone="success">{message}</AuthAlert>}

      {listings.length === 0 ? (
        <p className="text-sm text-slate-500">Нет объявлений в этой категории.</p>
      ) : (
        <ul className="space-y-4">
          {listings.map((listing) => {
            const reports = reportsByListingId[listing.id] ?? [];
            const pendingReports = reports.filter((r) => r.status === "pending");
            const transactionType = listing.marketplace?.transactionType ?? "sell";

            return (
              <li
                key={listing.id}
                className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link
                      className="font-semibold text-slate-900 hover:underline"
                      href={
                        listing.listingType === "service"
                          ? `/services/${listing.id}`
                          : `/marketplace/${listing.id}`
                      }
                    >
                      {listing.title}
                    </Link>
                    <p className="mt-1 text-sm text-slate-600">
                      <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                        {listing.listingType === "service" ? "Услуга" : "Marketplace"}
                      </span>
                      {formatPrice(
                        listing.priceAmount,
                        listing.priceCurrency,
                        transactionType,
                      )}{" "}
                      · {LISTING_STATUS_LABELS[listing.status]}
                      {listing.pendingReportsCount > 0 && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                          {listing.pendingReportsCount} жалоб
                        </span>
                      )}
                    </p>
                    {listing.moderationReason && (
                      <p className="mt-1 text-xs text-red-600">
                        Причина: {listing.moderationReason}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-slate-400">{listing.id.slice(0, 8)}…</span>
                </div>

                {pendingReports.length > 0 && (
                  <div className="space-y-2 rounded-lg bg-amber-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                      Жалобы
                    </p>
                    {pendingReports.map((report) => (
                      <div key={report.id} className="text-sm text-amber-900">
                        <p className="font-medium">
                          {REPORT_REASON_LABELS[report.reason] ?? report.reason}
                        </p>
                        {report.details && (
                          <p className="text-amber-800">{report.details}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            className="disabled:opacity-60"
                            disabled={pending}
                            onClick={() =>
                              run(
                                () =>
                                  adminSetListingReportStatusAction({
                                    reportId: report.id,
                                    status: "action_taken",
                                  }),
                                "Жалоба обработана",
                              )
                            }
                            type="button"
                          >
                            Принять меры
                          </Button>
                          <Button
                            className="disabled:opacity-60"
                            disabled={pending}
                            onClick={() =>
                              run(
                                () =>
                                  adminSetListingReportStatusAction({
                                    reportId: report.id,
                                    status: "dismissed",
                                  }),
                                "Жалоба отклонена",
                              )
                            }
                            type="button"
                            variant="secondary"
                          >
                            Отклонить
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {listing.status !== "active" && (
                    <Button
                      className="gap-2 disabled:opacity-60"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () =>
                            adminSetListingStatusAction({
                              listingId: listing.id,
                              status: "active",
                            }),
                          "Восстановлено",
                        )
                      }
                      type="button"
                    >
                      {pending && <BrandPinLoader size="sm" />}
                      Восстановить
                    </Button>
                  )}
                  {listing.status === "active" && (
                    <>
                      <Button
                        className="disabled:opacity-60"
                        disabled={pending}
                        onClick={() =>
                          run(
                            () =>
                              adminSetListingStatusAction({
                                listingId: listing.id,
                                status: "removed",
                                reason: "Модерация",
                              }),
                            "Удалено",
                          )
                        }
                        type="button"
                        variant="secondary"
                      >
                        Удалить
                      </Button>
                      <Button
                        className="disabled:opacity-60"
                        disabled={pending}
                        onClick={() =>
                          run(
                            () =>
                              adminSetListingStatusAction({
                                listingId: listing.id,
                                status: "rejected",
                                reason: "Отклонено модерацией",
                              }),
                            "Отклонено",
                          )
                        }
                        type="button"
                        variant="secondary"
                      >
                        Отклонить
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
