"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import {
  submitErrorReportAction,
  type PlatformErrorReportType,
} from "@/lib/error-reports/actions";
import { AuthAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

export type SupportRequestModalProps = {
  open: boolean;
  onClose: () => void;
  reportType: PlatformErrorReportType;
  title: string;
  description: string;
  placeholder: string;
  /** Route-segment-style identifier, e.g. "business", "professional". */
  entityType?: string | null;
  entityId?: string | null;
  entityName?: string | null;
};

/**
 * Shared submit-a-message modal used for all three surfaces: the header
 * "error report" / "ask a question" menu, and the per-card "complain about
 * this listing" button. Same backend action (submitErrorReportAction),
 * different reportType + optional entity context.
 */
export function SupportRequestModal({
  open,
  onClose,
  reportType,
  title,
  description,
  placeholder,
  entityType,
  entityId,
  entityName,
}: SupportRequestModalProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const titleId = useId();

  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!open || !mounted) return null;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const qs = searchParams?.toString();
    const pagePath = qs ? `${pathname}?${qs}` : pathname || "/";
    const pageUrl =
      typeof window !== "undefined" ? window.location.href : null;

    startTransition(async () => {
      const result = await submitErrorReportAction({
        message,
        pagePath,
        pageUrl,
        reportType,
        entityType,
        entityId,
        entityName,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuccess(result.message ?? "Спасибо! Сообщение отправлено.");
      setMessage("");
      window.setTimeout(() => {
        setSuccess(null);
        onClose();
      }, 900);
    });
  }

  return createPortal(
    <div className="fixed inset-0 z-[1950] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4">
      <button
        aria-label="Закрыть"
        className="absolute inset-0 cursor-default"
        type="button"
        onClick={onClose}
      />
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative z-10 flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-xl sm:rounded-2xl"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900" id={titleId}>
              {title}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">{description}</p>
          </div>
          <button
            aria-label="Закрыть"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            type="button"
            onClick={onClose}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <form className="space-y-3 overflow-y-auto px-4 py-4" onSubmit={handleSubmit}>
          {error ? <AuthAlert>{error}</AuthAlert> : null}
          {success ? <AuthAlert tone="success">{success}</AuthAlert> : null}

          {entityName ? (
            <p className="truncate rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
              О карточке: {entityName}
            </p>
          ) : null}

          <label className="block space-y-1.5 text-sm" htmlFor="support-request-message">
            <span className="font-medium text-slate-700">Текст сообщения</span>
            <textarea
              autoFocus
              className="min-h-28 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none ring-slate-900 focus:ring-2"
              id="support-request-message"
              maxLength={4000}
              name="message"
              placeholder={placeholder}
              required
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>

          {!entityName ? (
            <p className="truncate text-xs text-slate-400">
              Страница: {pathname || "/"}
              {searchParams?.toString() ? `?${searchParams.toString()}` : ""}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              className="gap-2 disabled:opacity-60"
              disabled={pending || message.trim().length < 3}
              type="submit"
            >
              {pending ? <BrandPinLoader size="sm" /> : null}
              Отправить
            </Button>
            <Button disabled={pending} type="button" variant="secondary" onClick={onClose}>
              Отмена
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
