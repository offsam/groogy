"use client";

import { useState, useTransition } from "react";

import { reportListingAction } from "@/lib/listings/actions";
import { AuthAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { REPORT_REASON_LABELS, MARKETPLACE_REPORT_REASONS, type ListingReportReason } from "@/types/listing";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type ReportListingFormProps = {
  listingId: string;
  reasons?: ListingReportReason[];
};

export function ReportListingForm({
  listingId,
  reasons = MARKETPLACE_REPORT_REASONS,
}: ReportListingFormProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const form = e.currentTarget;
    const formData = new FormData(form);
    const reason = String(formData.get("reason") ?? "");
    const details = String(formData.get("details") ?? "");

    startTransition(async () => {
      const result = await reportListingAction({
        listingId,
        reason,
        details: details || null,
      });
      if (!result.ok) {
        setError(result.message);
      } else {
        setMessage(result.message ?? "Жалоба отправлена.");
        form.reset();
        setOpen(false);
      }
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} type="button" variant="secondary">
        Пожаловаться
      </Button>
    );
  }

  return (
    <form
      className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
      onSubmit={handleSubmit}
    >
      <p className="text-sm font-medium text-slate-900">Жалоба на объявление</p>

      {error && <AuthAlert>{error}</AuthAlert>}
      {message && <AuthAlert tone="success">{message}</AuthAlert>}

      <label className="block space-y-1.5 text-sm" htmlFor="report-reason">
        <span className="font-medium text-slate-700">Причина</span>
        <select
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
          id="report-reason"
          name="reason"
          required
        >
          <option value="">Выберите…</option>
          {reasons.map((value) => (
            <option key={value} value={value}>
              {REPORT_REASON_LABELS[value]}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1.5 text-sm" htmlFor="report-details">
        <span className="font-medium text-slate-700">Комментарий (необязательно)</span>
        <textarea
          className="min-h-20 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
          id="report-details"
          maxLength={1000}
          name="details"
          placeholder="Опишите проблему…"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button className="gap-2 disabled:opacity-60" disabled={pending} type="submit">
          {pending && <BrandPinLoader size="sm" />}
          Отправить
        </Button>
        <Button
          disabled={pending}
          onClick={() => setOpen(false)}
          type="button"
          variant="secondary"
        >
          Отмена
        </Button>
      </div>
    </form>
  );
}
