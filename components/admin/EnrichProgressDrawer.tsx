"use client";

import { createPortal } from "react-dom";
import {
  Check,
  Circle,
  Loader2,
  X,
  AlertCircle,
  Minus,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  ENRICH_STEP_LABELS,
  ENRICH_STEP_ORDER,
  fieldLabel,
  resourceKindLabel,
  resourcesFromResult,
  summarizeResources,
  type EnrichHistoryRow,
  type EnrichResourceState,
  type EnrichRunResult,
  type EnrichStepId,
  type EnrichStepState,
} from "@/lib/import-review/enrich-progress";

function formatWhen(iso: string) {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "short",
      timeStyle: "medium",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function StepIcon({ status }: { status: EnrichStepState["status"] }) {
  if (status === "running") {
    return <Loader2 className="size-4 animate-spin text-brand-blue" />;
  }
  if (status === "done") {
    return <Check className="size-4 text-emerald-600" />;
  }
  if (status === "error") {
    return <AlertCircle className="size-4 text-red-600" />;
  }
  if (status === "skipped") {
    return <Minus className="size-4 text-slate-400" />;
  }
  return <Circle className="size-3.5 text-slate-300" />;
}

function ResourceIcon({ resource }: { resource: EnrichResourceState }) {
  if (resource.status === "running") {
    return <Loader2 className="size-4 animate-spin text-brand-blue" />;
  }
  if (resource.status === "queued") {
    return <Circle className="size-3.5 text-slate-300" />;
  }
  if (resource.status === "skipped" || resource.outcome === "skipped") {
    return <Minus className="size-4 text-amber-600" aria-label="пропущено" />;
  }
  if (resource.outcome === "ok") {
    return <Check className="size-4 text-emerald-600" aria-label="ок" />;
  }
  // empty or error → крестик
  return <X className="size-4 text-red-600" aria-label="не вышло" />;
}

function ResultSummary({ result }: { result: EnrichRunResult }) {
  if (result.skipped) {
    return (
      <p className="text-sm text-amber-800">
        Пропуск: {result.reason || "не удалось запустить"}
      </p>
    );
  }
  const keys = Object.keys(result.patch ?? {});
  const resources = resourcesFromResult(result);
  const summary =
    result.resources_ok != null || result.resources_failed != null
      ? {
          ok: result.resources_ok ?? 0,
          failed: result.resources_failed ?? 0,
        }
      : summarizeResources(resources);
  return (
    <div className="space-y-2 text-sm">
      <p className="font-medium text-slate-900">
        Результат
        {result.score_before != null || result.score_after != null
          ? ` · полнота ${result.score_before ?? "—"} → ${result.score_after ?? "—"}`
          : null}
      </p>
      {summary.ok + summary.failed > 0 ? (
        <p className="text-slate-700">
          Ресурсы:{" "}
          <span className="font-medium text-emerald-700">{summary.ok} ок</span>
          {" / "}
          <span className="font-medium text-red-700">
            {summary.failed} не вышло
          </span>
        </p>
      ) : null}
      {keys.length > 0 ? (
        <ul className="space-y-1 text-slate-700">
          {keys.map((key) => (
            <li key={key}>
              <span className="font-medium text-emerald-700">+</span>{" "}
              {fieldLabel(key)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-slate-600">
          {result.reason ||
            "Новых полей не нашлось — смотрите маршрут ресурсов."}
        </p>
      )}
      {result.directory_match ? (
        <p className="text-xs text-slate-500">
          Справочник: совпадение по {result.directory_match}
        </p>
      ) : null}
    </div>
  );
}

function ResourceList({
  resources,
  emptyHint,
}: {
  resources: EnrichResourceState[];
  emptyHint?: string | null;
}) {
  if (resources.length === 0) {
    if (!emptyHint) return null;
    return (
      <p className="rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2.5 text-sm text-amber-900">
        {emptyHint}
      </p>
    );
  }
  return (
    <ol className="space-y-2">
      {resources.map((r) => {
        const skipped = r.status === "skipped" || r.outcome === "skipped";
        const failed =
          !skipped &&
          (r.outcome === "empty" ||
            r.outcome === "error" ||
            r.status === "error");
        return (
          <li
            key={`${r.url}-${r.status}-${r.error || ""}`}
            className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5"
          >
            <div className="mt-0.5 shrink-0">
              <ResourceIcon resource={r} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900">
                {resourceKindLabel(r.kind)}
              </p>
              {r.url.startsWith("http") ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-xs text-brand-blue hover:underline"
                >
                  <span className="truncate">{r.url}</span>
                  <ExternalLink className="size-3 shrink-0 opacity-60" />
                </a>
              ) : (
                <p className="mt-0.5 truncate text-xs text-slate-500">{r.url}</p>
              )}
              {r.status === "queued" ? (
                <p className="mt-0.5 text-xs text-slate-400">в очереди…</p>
              ) : null}
              {r.status === "running" ? (
                <p className="mt-0.5 text-xs text-slate-500">открываем…</p>
              ) : null}
              {r.outcome === "ok" && r.fields && r.fields.length > 0 ? (
                <p className="mt-1 text-xs text-emerald-800">
                  {r.fields.map(fieldLabel).join(", ")}
                </p>
              ) : null}
              {skipped ? (
                <p className="mt-1 text-xs text-amber-800">
                  пропущено: {r.error || "не подходит для обхода"}
                </p>
              ) : null}
              {failed ? (
                <p className="mt-1 text-xs text-red-700">
                  {r.outcome === "empty"
                    ? "ничего не извлечено"
                    : r.error || "ошибка"}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export type EnrichProgressDrawerProps = {
  open: boolean;
  mounted: boolean;
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  tab: "run" | "history";
  onTabChange: (tab: "run" | "history") => void;
  running: boolean;
  label: string | null;
  error: string | null;
  result: EnrichRunResult | null;
  /** Pipeline steps (pre-publish). Optional. */
  steps?: Record<EnrichStepId, EnrichStepState> | null;
  /** Which steps this branch actually runs. Defaults to the full pipeline. */
  stepOrder?: readonly EnrichStepId[];
  /** Live / finished BFS resources. */
  resources: EnrichResourceState[];
  history: EnrichHistoryRow[] | null;
  historyLoading: boolean;
  historyError: string | null;
  selectedHistory: EnrichHistoryRow | null;
  onSelectHistory: (row: EnrichHistoryRow | null) => void;
  onLoadHistory: () => void;
  onStart: () => void;
  onClose: () => void;
  startDisabled?: boolean;
};

export function EnrichProgressDrawer({
  open,
  mounted,
  title,
  subtitle,
  eyebrow = "Обогащение",
  tab,
  onTabChange,
  running,
  label,
  error,
  result,
  steps,
  stepOrder = ENRICH_STEP_ORDER,
  resources,
  history,
  historyLoading,
  historyError,
  selectedHistory,
  onSelectHistory,
  onLoadHistory,
  onStart,
  onClose,
  startDisabled,
}: EnrichProgressDrawerProps) {
  if (!open || !mounted) return null;

  const liveSummary = summarizeResources(resources);

  return createPortal(
    <div className="fixed inset-0 z-[1300] flex justify-end">
      <button
        type="button"
        aria-label="Закрыть панель"
        className="absolute inset-0 bg-slate-950/40"
        disabled={running}
        onClick={onClose}
      />
      <div
        aria-modal="true"
        className="relative flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-xl max-sm:max-w-none max-sm:border-l-0"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              {eyebrow}
            </p>
            <p className="mt-0.5 truncate text-sm font-medium text-slate-900">
              {label || title || "Эта карточка"}
            </p>
            {subtitle ? (
              <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
            ) : (
              <p className="mt-1 text-xs text-slate-500">
                Маршрут ресурсов · ✓ нашлось · ✗ не вышло
              </p>
            )}
          </div>
          <button
            aria-label="Закрыть панель"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
            type="button"
            disabled={running}
            onClick={onClose}
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-slate-100 px-3 py-2">
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm ${
              tab === "run"
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
            style={tab === "run" ? { color: "#ffffff" } : undefined}
            onClick={() => onTabChange("run")}
          >
            Процесс
          </button>
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm ${
              tab === "history"
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
            style={tab === "history" ? { color: "#ffffff" } : undefined}
            onClick={() => {
              onTabChange("history");
              onLoadHistory();
            }}
          >
            История
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {tab === "run" ? (
            <div className="space-y-4">
              {steps ? (
                <ol className="space-y-2">
                  {stepOrder.map((step) => {
                    const state = steps[step];
                    return (
                      <li
                        key={step}
                        className="flex gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2"
                      >
                        <div className="mt-0.5 shrink-0">
                          <StepIcon status={state.status} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900">
                            {ENRICH_STEP_LABELS[step]}
                          </p>
                          {state.detail ? (
                            <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                              {state.detail}
                            </p>
                          ) : state.status === "pending" ? (
                            <p className="mt-0.5 text-xs text-slate-400">
                              ожидает…
                            </p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : null}

              {running || result || resources.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                      Ресурсы
                    </p>
                    {liveSummary.ok + liveSummary.failed > 0 ? (
                      <p className="text-xs tabular-nums text-slate-600">
                        <span className="text-emerald-700">
                          {liveSummary.ok} ок
                        </span>
                        {" / "}
                        <span className="text-red-700">
                          {liveSummary.failed} нет
                        </span>
                      </p>
                    ) : null}
                  </div>
                  <ResourceList
                    resources={resources}
                    emptyHint={
                      result
                        ? "Обход не запускался — нет подходящих ссылок или все были пропущены."
                        : null
                    }
                  />
                </div>
              ) : null}

              {error ? (
                <div
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800"
                  role="alert"
                >
                  {error}
                </div>
              ) : null}

              {result ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-3">
                  <ResultSummary result={result} />
                </div>
              ) : null}

              {!running && !result && !error && resources.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Нажмите «Обогатить», чтобы пройти по источникам карточки и
                  увидеть, откуда что взялось.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              {historyLoading ? (
                <p className="inline-flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="size-4 animate-spin" />
                  Загрузка…
                </p>
              ) : null}
              {historyError ? (
                <p className="text-sm text-red-700">{historyError}</p>
              ) : null}
              {!historyLoading && history && history.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Пока нет запусков обогащения для этой карточки.
                </p>
              ) : null}
              {selectedHistory ? (
                <div className="space-y-3">
                  <button
                    type="button"
                    className="text-sm font-medium text-brand-blue hover:underline"
                    onClick={() => onSelectHistory(null)}
                  >
                    ← к списку
                  </button>
                  <p className="text-xs text-slate-500">
                    {formatWhen(selectedHistory.created_at)}
                  </p>
                  {selectedHistory.note ? (
                    <p className="text-sm text-slate-700">
                      {selectedHistory.note}
                    </p>
                  ) : null}
                  <ResultSummary
                    result={
                      selectedHistory.changed_fields as EnrichRunResult
                    }
                  />
                  <ResourceList
                    resources={resourcesFromResult(
                      selectedHistory.changed_fields as EnrichRunResult,
                    )}
                    emptyHint="В этом запуске маршрутов не было — ссылки пропущены или сайта не было."
                  />
                  {selectedHistory.changed_fields.steps ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
                      <p className="font-semibold text-slate-800">
                        Шаги пайплайна
                      </p>
                      <ul className="mt-2 space-y-1">
                        {(
                          [
                            "source_text",
                            "group_location",
                            "website",
                            "directories",
                            "cleanup",
                          ] as const
                        ).map((key) => {
                          const found =
                            selectedHistory.changed_fields.steps?.[key] ?? [];
                          return (
                            <li key={key}>
                              {ENRICH_STEP_LABELS[key]}:{" "}
                              {found.length
                                ? found.map(fieldLabel).join(", ")
                                : "—"}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : (
                <ul className="space-y-2">
                  {(history ?? []).map((row) => {
                    const patchKeys = Object.keys(
                      (row.changed_fields.patch as Record<string, unknown>) ??
                        {},
                    );
                    const res = resourcesFromResult(
                      row.changed_fields as EnrichRunResult,
                    );
                    const sum = summarizeResources(res);
                    return (
                      <li key={row.id}>
                        <button
                          type="button"
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-slate-300 hover:bg-slate-50"
                          onClick={() => onSelectHistory(row)}
                        >
                          <p className="text-sm font-medium text-slate-900">
                            {formatWhen(row.created_at)}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {row.note ||
                              (patchKeys.length
                                ? `+${patchKeys.join(", ")}`
                                : "без новых полей")}
                          </p>
                          {sum.ok + sum.failed > 0 ? (
                            <p className="mt-1 text-xs text-slate-600">
                              {sum.ok} ок / {sum.failed} нет
                            </p>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={startDisabled || running}
              onClick={onStart}
            >
              {running ? "Идёт…" : "Запустить снова"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={running}
              onClick={onClose}
            >
              Закрыть
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
