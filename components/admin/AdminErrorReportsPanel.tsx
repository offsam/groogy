"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import {
  triggerErrorReportAutofixAction,
  updateErrorReportStatusAction,
  type PlatformErrorReportRow,
  type PlatformErrorReportType,
} from "@/lib/error-reports/actions";
import { Button } from "@/components/ui/Button";
import type { PlatformErrorReportStatus } from "@/types/database";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<PlatformErrorReportStatus, string> = {
  open: "Открыта",
  reviewed: "Просмотрена",
  resolved: "Решена",
  dismissed: "Отклонена",
  needs_attention: "Требует внимания",
};

const STATUS_STYLES: Record<PlatformErrorReportStatus, string> = {
  open: "bg-red-50 text-red-700 border-red-200",
  reviewed: "bg-amber-50 text-amber-800 border-amber-200",
  resolved: "bg-emerald-50 text-emerald-800 border-emerald-200",
  dismissed: "bg-slate-100 text-slate-600 border-slate-200",
  needs_attention: "bg-orange-50 text-orange-800 border-orange-200",
};

const TYPE_LABELS: Record<PlatformErrorReportType, string> = {
  error: "Ошибка",
  question: "Вопрос",
  complaint: "Жалоба",
};

const TYPE_STYLES: Record<PlatformErrorReportType, string> = {
  error: "bg-red-50 text-red-700 border-red-200",
  question: "bg-blue-50 text-blue-700 border-blue-200",
  complaint: "bg-purple-50 text-purple-700 border-purple-200",
};

type AdminErrorReportsPanelProps = {
  reports: PlatformErrorReportRow[];
  filter: PlatformErrorReportStatus | "all";
};

export function AdminErrorReportsPanel({
  reports,
  filter,
}: AdminErrorReportsPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [autofixMessage, setAutofixMessage] = useState<string | null>(null);

  function setStatus(id: string, status: PlatformErrorReportStatus) {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      const result = await updateErrorReportStatusAction({
        id,
        status,
        adminNote: notes[id] ?? null,
      });
      setBusyId(null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  function autofix(id: string) {
    setError(null);
    setAutofixMessage(null);
    setBusyId(id);
    startTransition(async () => {
      const result = await triggerErrorReportAutofixAction({ id });
      setBusyId(null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setAutofixMessage(result.message ?? "Issue создан.");
      router.refresh();
    });
  }

  if (reports.length === 0) {
    return (
      <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        {filter === "open"
          ? "Нет открытых сообщений об ошибках."
          : "Нет сообщений с этим фильтром."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {autofixMessage ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {autofixMessage}
        </p>
      ) : null}
      <ul className="space-y-4">
        {reports.map((report) => {
          const href = report.pageUrl || report.pagePath;
          const busy = pending && busyId === report.id;
          return (
            <li
              key={report.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
                        TYPE_STYLES[report.reportType],
                      )}
                    >
                      {TYPE_LABELS[report.reportType]}
                    </span>
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
                        STATUS_STYLES[report.status],
                      )}
                    >
                      {STATUS_LABELS[report.status]}
                    </span>
                    <span className="text-xs text-slate-400">
                      {new Date(report.createdAt).toLocaleString("ru-RU")}
                    </span>
                  </div>
                  {report.entityName ? (
                    <p className="truncate text-xs text-slate-500">
                      Карточка ({report.entityType}): {report.entityName}
                    </p>
                  ) : null}
                  <Link
                    className="inline-flex max-w-full items-center gap-1 truncate text-sm font-medium text-brand-blue hover:underline"
                    href={report.pagePath}
                    target="_blank"
                  >
                    <span className="truncate">{report.pagePath}</span>
                    <ExternalLink
                      aria-hidden="true"
                      className="size-3.5 shrink-0 text-slate-400"
                    />
                  </Link>
                  {report.pageUrl && report.pageUrl !== href ? (
                    <p className="truncate text-xs text-slate-400">
                      {report.pageUrl}
                    </p>
                  ) : null}
                </div>
              </div>

              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                {report.message}
              </p>

              {report.adminNote ? (
                <p className="mt-2 text-sm text-slate-600">
                  <span className="font-medium text-slate-800">Заметка: </span>
                  {report.adminNote}
                </p>
              ) : null}

              <label className="mt-3 block space-y-1.5 text-sm">
                <span className="font-medium text-slate-700">Заметка</span>
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
                  value={notes[report.id] ?? report.adminNote ?? ""}
                  onChange={(e) =>
                    setNotes((prev) => ({
                      ...prev,
                      [report.id]: e.target.value,
                    }))
                  }
                />
              </label>

              {report.autofixSummary ? (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <p className="text-xs font-medium text-slate-500">
                    Отчёт от Claude
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {report.autofixSummary}
                  </p>
                </div>
              ) : null}

              {report.githubIssueUrl ? (
                <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <Link
                    className="text-brand-blue hover:underline"
                    href={report.githubIssueUrl}
                    target="_blank"
                  >
                    Issue на GitHub →
                  </Link>
                  {report.autofixPrUrl ? (
                    <Link
                      className="text-brand-blue hover:underline"
                      href={report.autofixPrUrl}
                      target="_blank"
                    >
                      Pull Request →
                    </Link>
                  ) : null}
                </p>
              ) : report.reportType === "error" ? (
                <div className="mt-3">
                  <Button
                    disabled={busy}
                    type="button"
                    variant="secondary"
                    onClick={() => autofix(report.id)}
                  >
                    {busy ? "Создаю issue…" : "Почини (Claude → PR)"}
                  </Button>
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                {report.status !== "reviewed" ? (
                  <Button
                    disabled={busy}
                    type="button"
                    variant="secondary"
                    onClick={() => setStatus(report.id, "reviewed")}
                  >
                    Просмотрена
                  </Button>
                ) : null}
                {report.status !== "resolved" ? (
                  <Button
                    disabled={busy}
                    type="button"
                    onClick={() => setStatus(report.id, "resolved")}
                  >
                    Решена
                  </Button>
                ) : null}
                {report.status !== "dismissed" ? (
                  <Button
                    disabled={busy}
                    type="button"
                    variant="secondary"
                    onClick={() => setStatus(report.id, "dismissed")}
                  >
                    Отклонить
                  </Button>
                ) : null}
                {report.status !== "open" ? (
                  <Button
                    disabled={busy}
                    type="button"
                    variant="secondary"
                    onClick={() => setStatus(report.id, "open")}
                  >
                    Вернуть в открытые
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
