"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Circle, X, AlertCircle, Minus, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  ENRICH_STEP_LABELS,
  ENRICH_STEP_ORDER,
  enrichConflictCanAdd,
  fieldLabel,
  resourceKindLabel,
  resourcesFromResult,
  summarizeResources,
  type EnrichConflictAction,
  type EnrichConflictMode,
  type EnrichHistoryRow,
  type EnrichResourceState,
  type EnrichRunResult,
  type EnrichStepId,
  type EnrichStepState,
} from "@/lib/import-review/enrich-progress";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

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
    return <BrandPinLoader size="sm" />;
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
    return <BrandPinLoader size="sm" />;
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

function formatFieldValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return "—";
    return t.length > 80 ? `${t.slice(0, 80)}…` : t;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    const joined = value.map((v) => String(v)).join(", ");
    return joined.length > 80 ? `${joined.slice(0, 80)}…` : joined;
  }
  try {
    const s = JSON.stringify(value);
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  } catch {
    return "…";
  }
}

function HistoryFieldList({
  result,
  runId,
  onRevertFields,
  revertPending,
  disabled,
}: {
  result: EnrichRunResult;
  runId: string;
  onRevertFields?: (runId: string, fields: string[]) => void;
  revertPending?: boolean;
  disabled?: boolean;
}) {
  const patch = result.patch ?? {};
  const before = result.before ?? {};
  const keys = Object.keys(patch);
  const reverted = new Set(result.reverted_fields ?? []);
  if (!keys.length) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        Поля этого обогащения
      </p>
      <ul className="mt-2 space-y-2">
        {keys.map((key) => {
          const gone = Boolean(result.reverted_at) || reverted.has(key);
          const prior = before[key];
          const hadPrior =
            prior != null &&
            String(prior).trim() !== "" &&
            !jsonishEq(prior, patch[key]);
          return (
            <li
              key={key}
              className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50/70 px-2.5 py-2"
            >
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-medium ${
                    gone ? "text-slate-400 line-through" : "text-slate-900"
                  }`}
                >
                  {fieldLabel(key)}
                </p>
                <p
                  className={`mt-0.5 break-words text-xs ${
                    gone ? "text-slate-400" : "text-slate-600"
                  }`}
                >
                  {formatFieldValue(patch[key])}
                </p>
                {hadPrior ? (
                  <p className="mt-0.5 break-words text-xs text-amber-700/90">
                    было: {formatFieldValue(prior)}
                  </p>
                ) : null}
              </div>
              {onRevertFields && !gone ? (
                <button
                  type="button"
                  disabled={disabled || revertPending}
                  className="shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                  onClick={() => onRevertFields(runId, [key])}
                >
                  Удалить
                </button>
              ) : gone ? (
                <span className="shrink-0 pt-1 text-[11px] text-slate-400">
                  снято
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {onRevertFields &&
      keys.some((k) => !reverted.has(k)) &&
      !result.reverted_at ? (
        <button
          type="button"
          disabled={disabled || revertPending}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-100 disabled:opacity-60"
          onClick={() =>
            onRevertFields(
              runId,
              keys.filter((k) => !reverted.has(k)),
            )
          }
        >
          {revertPending ? (
            <BrandPinLoader size="sm" />
          ) : null}
          Удалить все поля этого запуска
        </button>
      ) : null}
    </div>
  );
}

function jsonishEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function PendingReviewPanel({
  result,
  selectedKeys,
  selectedConflictKeys,
  onToggleKey,
  onToggleConflict,
  onSave,
  pending,
  disabled,
  message,
}: {
  result: EnrichRunResult;
  selectedKeys: Set<string>;
  selectedConflictKeys: Set<string>;
  onToggleKey: (key: string) => void;
  onToggleConflict: (key: string) => void;
  onSave?: () => void;
  pending?: boolean;
  disabled?: boolean;
  message?: string | null;
}) {
  const patch = result.patch ?? {};
  const patchKeys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  const conflicts = result.field_conflicts ?? [];
  const hasLocations =
    Boolean(result.extra_addresses?.length) ||
    (result.steps?.cleanup ?? []).includes("locations");
  const pendingJobs = result.pending_jobs ?? [];
  const hasJobs =
    pendingJobs.length > 0 || (result.steps?.cleanup ?? []).includes("jobs");
  const rows: Array<{
    id: string;
    kind: "patch" | "conflict" | "locations" | "jobs";
    title: string;
    detail: string;
    checked: boolean;
    onToggle: () => void;
  }> = [];

  for (const key of patchKeys) {
    const before = result.before?.[key];
    const hadBefore =
      before != null &&
      !(typeof before === "string" && before.trim() === "") &&
      before !== false;
    const nextVal = patch[key];
    const preview =
      typeof nextVal === "string"
        ? nextVal.slice(0, 160)
        : nextVal == null
          ? "очистить"
          : JSON.stringify(nextVal).slice(0, 160);
    rows.push({
      id: `patch:${key}`,
      kind: "patch",
      title: `${hadBefore ? "Изменить" : "Добавить"}: ${fieldLabel(key)}`,
      detail: preview,
      checked: selectedKeys.has(key),
      onToggle: () => onToggleKey(key),
    });
  }

  if (hasLocations) {
    const lines = (result.extra_addresses ?? []).slice(0, 4);
    rows.push({
      id: "locations",
      kind: "locations",
      title: "Добавить: адреса офисов",
      detail: lines.length ? lines.join(" · ") : "несколько адресов с сайта",
      checked: selectedKeys.has("locations"),
      onToggle: () => onToggleKey("locations"),
    });
  }

  if (hasJobs) {
    const lines = pendingJobs.slice(0, 3).map((j) => {
      const loc = [j.address_line, j.city, j.postal_code]
        .filter(Boolean)
        .join(", ");
      return loc ? `${j.title} · ${loc}` : j.title;
    });
    rows.push({
      id: "jobs",
      kind: "jobs",
      title: "Добавить: вакансии",
      detail: lines.length
        ? lines.join(" · ")
        : "вакансия из объявления (отдельная карточка)",
      checked: selectedKeys.has("jobs"),
      onToggle: () => onToggleKey("jobs"),
    });
  }

  for (const c of conflicts) {
    rows.push({
      id: `conflict:${c.key}`,
      kind: "conflict",
      title: `Заменить: ${fieldLabel(c.key)}`,
      detail: `нашлось: ${c.found.slice(0, 120)}`,
      checked: selectedConflictKeys.has(c.key),
      onToggle: () => onToggleConflict(c.key),
    });
  }

  if (!rows.length) {
    return (
      <p className="text-sm text-slate-600">
        {result.reason || "Новых полей нет — сохранять нечего."}
      </p>
    );
  }

  const selectedCount =
    [...selectedKeys].filter((k) =>
      k === "locations"
        ? hasLocations
        : k === "jobs"
          ? hasJobs
          : patchKeys.includes(k),
    ).length + selectedConflictKeys.size;

  return (
    <div className="rounded-xl border border-brand-blue/30 bg-sky-50/60 px-3 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">
        Что сохранить
      </p>
      <p className="mt-1 text-xs text-slate-600">
        Отметьте поля и нажмите «Сохранить» — до этого карточка не меняется.
      </p>
      <ul className="mt-3 space-y-2">
        {rows.map((row) => (
          <li key={row.id}>
            <label
              className={`flex min-h-11 cursor-pointer gap-2.5 rounded-lg border px-2.5 py-2.5 transition ${
                row.checked
                  ? "border-brand-blue/40 bg-white"
                  : "border-slate-200 bg-white/70"
              } ${disabled || pending ? "opacity-60" : ""}`}
            >
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0 accent-[var(--brand-blue,#2563eb)]"
                checked={row.checked}
                disabled={disabled || pending}
                onChange={row.onToggle}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-900">
                  {row.title}
                </span>
                <span className="mt-0.5 block break-words text-xs text-slate-600">
                  {row.detail}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {onSave ? (
        <button
          type="button"
          disabled={disabled || pending || selectedCount === 0}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-blue px-3 py-2 text-sm font-medium text-white transition hover:opacity-95 disabled:opacity-60"
          style={{ color: "#ffffff" }}
          onClick={onSave}
        >
          {pending ? <BrandPinLoader size="sm" /> : null}
          Сохранить
          {selectedCount > 0 ? ` (${selectedCount})` : ""}
        </button>
      ) : null}
      {message ? (
        <p className="mt-2 text-xs text-slate-700">{message}</p>
      ) : null}
    </div>
  );
}

function FieldConflictsPanel({
  conflicts,
  modes,
  onModeChange,
  onApply,
  pending,
  disabled,
  message,
  entityKind,
}: {
  conflicts: NonNullable<EnrichRunResult["field_conflicts"]>;
  modes: Record<string, "leave" | EnrichConflictMode>;
  onModeChange: (key: string, mode: "leave" | EnrichConflictMode) => void;
  onApply?: () => void;
  pending?: boolean;
  disabled?: boolean;
  message?: string | null;
  entityKind?: string | null;
}) {
  if (!conflicts.length) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-800">
        Расхождения
      </p>
      <p className="mt-1 text-xs text-amber-900/80">
        На ресурсах нашлось другое значение. Выберите действие для каждого
        поля.
      </p>
      <ul className="mt-2 space-y-3">
        {conflicts.map((c) => {
          const mode = modes[c.key] ?? "leave";
          const canAdd = enrichConflictCanAdd(c.key, entityKind);
          return (
            <li
              key={c.key}
              className="rounded-lg border border-amber-100 bg-white/80 px-2.5 py-2.5"
            >
              <p className="text-sm font-medium text-slate-900">
                {fieldLabel(c.key)}
              </p>
              <p className="mt-0.5 break-words text-xs text-emerald-800">
                нашлось: {c.found}
              </p>
              <p className="mt-0.5 break-words text-xs text-slate-500">
                сейчас: {c.current}
              </p>
              <div
                className="mt-2 grid grid-cols-3 gap-1.5"
                role="radiogroup"
                aria-label={fieldLabel(c.key)}
              >
                {(
                  [
                    { id: "leave", label: "Оставить" },
                    { id: "replace", label: "Заменить" },
                    { id: "add", label: "Добавить" },
                  ] as const
                ).map((opt) => {
                  const addDisabled = opt.id === "add" && !canAdd;
                  return (
                    <label
                      key={opt.id}
                      className={`flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-lg border px-1 text-center text-[11px] font-medium leading-tight transition ${
                        mode === opt.id
                          ? "border-amber-400 bg-amber-100 text-amber-950"
                          : "border-slate-200 bg-white text-slate-700"
                      } ${
                        addDisabled || disabled || pending
                          ? "cursor-not-allowed opacity-50"
                          : "hover:border-amber-300"
                      }`}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        name={`conflict-${c.key}`}
                        value={opt.id}
                        checked={mode === opt.id}
                        disabled={disabled || pending || addDisabled}
                        onChange={() => onModeChange(c.key, opt.id)}
                      />
                      {opt.label}
                      {addDisabled ? (
                        <span className="mt-0.5 text-[9px] font-normal text-slate-400">
                          нельзя
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
      {onApply ? (
        <button
          type="button"
          disabled={disabled || pending}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-950 transition hover:bg-amber-100 disabled:opacity-60"
          onClick={onApply}
        >
          {pending ? <BrandPinLoader size="sm" /> : null}
          Применить
        </button>
      ) : null}
      {message ? (
        <p className="mt-2 text-xs text-amber-900/80">{message}</p>
      ) : null}
    </div>
  );
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
  const conflictCount = result.field_conflicts?.length ?? 0;
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
              {result.before?.[key] != null &&
              String(result.before[key]).trim() !== "" ? (
                <span className="text-xs text-amber-800">
                  {" "}
                  (заменим)
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : conflictCount > 0 ? (
        <p className="text-amber-900">
          {result.reason ||
            (result.pending_review
              ? `Автозаполнения нет — ниже ${conflictCount} расхождений.`
              : `Автозаполнения нет — ниже ${conflictCount} расхождений (Оставить / Заменить).`)}
        </p>
      ) : (
        <p className="text-slate-600">
          {result.reason ||
            "Новых полей нет — карточка уже заполнена или сайт ничего не отдал."}
        </p>
      )}
      {result.pending_review && (keys.length > 0 || conflictCount > 0) ? (
        <p className="text-xs font-medium text-slate-700">
          Черновик — карточка ещё не изменена. Отметьте поля и сохраните.
        </p>
      ) : null}
      {conflictCount > 0 && keys.length > 0 ? (
        <p className="text-xs text-amber-800">
          Ещё {conflictCount} расхождений — выберите действие ниже.
        </p>
      ) : null}
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
  steps?: Partial<Record<EnrichStepId, EnrichStepState>> | null;
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
  /** Abort in-flight enrich and roll back applied fields. */
  onStop?: () => void;
  startDisabled?: boolean;
  /** Undo latest enrich run (history tab). */
  onUndoLast?: () => void;
  undoLastPending?: boolean;
  undoLastMessage?: string | null;
  canUndoLast?: boolean;
  /** Revert selected fields from the opened history row. */
  onRevertFields?: (runId: string, fields: string[]) => void;
  revertFieldsPending?: boolean;
  revertFieldsMessage?: string | null;
  /** Apply confirmed field conflicts (found ≠ card). Leave modes omitted. */
  onApplyConflicts?: (actions: EnrichConflictAction[]) => void;
  applyConflictsPending?: boolean;
  applyConflictsMessage?: string | null;
  /** Entity kind for which conflict modes are available (e.g. address add). */
  conflictEntityKind?: string | null;
  /** Dry-run: checklist + Save selected fields. */
  onSaveSelection?: (input: {
    selectedKeys: string[];
    selectedConflictKeys: string[];
  }) => void;
  saveSelectionPending?: boolean;
  saveSelectionMessage?: string | null;
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
  onStop,
  startDisabled,
  onUndoLast,
  undoLastPending,
  undoLastMessage,
  canUndoLast,
  onRevertFields,
  revertFieldsPending,
  revertFieldsMessage,
  onApplyConflicts,
  applyConflictsPending,
  applyConflictsMessage,
  conflictEntityKind,
  onSaveSelection,
  saveSelectionPending,
  saveSelectionMessage,
}: EnrichProgressDrawerProps) {
  const conflicts = result?.field_conflicts ?? [];
  const pendingReview = Boolean(result?.pending_review);
  const [conflictModes, setConflictModes] = useState<
    Record<string, "leave" | EnrichConflictMode>
  >({});
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [selectedConflictKeys, setSelectedConflictKeys] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    const next: Record<string, "leave" | EnrichConflictMode> = {};
    for (const c of conflicts) {
      next[c.key] = "leave";
    }
    setConflictModes(next);

    if (!result?.pending_review) {
      setSelectedKeys(new Set());
      setSelectedConflictKeys(new Set());
      return;
    }
    const keys = new Set(Object.keys(result.patch ?? {}));
    if (
      result.extra_addresses?.length ||
      (result.steps?.cleanup ?? []).includes("locations")
    ) {
      keys.add("locations");
    }
    if (
      result.pending_jobs?.length ||
      (result.steps?.cleanup ?? []).includes("jobs")
    ) {
      keys.add("jobs");
    }
    setSelectedKeys(keys);
    // Conflicts default off — admin must opt in to replace.
    setSelectedConflictKeys(new Set());
  }, [result]);

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
                    const state: EnrichStepState = steps[step] ?? {
                      status: "pending",
                    };
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
                <div className="space-y-3">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-3">
                    <ResultSummary result={result} />
                  </div>
                  {pendingReview && onSaveSelection ? (
                    <PendingReviewPanel
                      result={result}
                      selectedKeys={selectedKeys}
                      selectedConflictKeys={selectedConflictKeys}
                      pending={saveSelectionPending}
                      disabled={running}
                      message={saveSelectionMessage}
                      onToggleKey={(key) => {
                        setSelectedKeys((prev) => {
                          const next = new Set(prev);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        });
                      }}
                      onToggleConflict={(key) => {
                        setSelectedConflictKeys((prev) => {
                          const next = new Set(prev);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        });
                      }}
                      onSave={() => {
                        onSaveSelection({
                          selectedKeys: [...selectedKeys],
                          selectedConflictKeys: [...selectedConflictKeys],
                        });
                      }}
                    />
                  ) : conflicts.length > 0 ? (
                    <FieldConflictsPanel
                      conflicts={conflicts}
                      modes={conflictModes}
                      entityKind={conflictEntityKind}
                      pending={applyConflictsPending}
                      disabled={running}
                      message={applyConflictsMessage}
                      onModeChange={(key, mode) => {
                        setConflictModes((prev) => ({ ...prev, [key]: mode }));
                      }}
                      onApply={
                        onApplyConflicts
                          ? () => {
                              const actions: EnrichConflictAction[] = conflicts
                                .map((c) => {
                                  const mode = conflictModes[c.key] ?? "leave";
                                  if (mode === "leave") return null;
                                  return { key: c.key, mode };
                                })
                                .filter(
                                  (a): a is EnrichConflictAction => a != null,
                                );
                              onApplyConflicts(actions);
                            }
                          : undefined
                      }
                    />
                  ) : null}
                </div>
              ) : null}

              {running &&
              !result &&
              !error &&
              resources.length === 0 &&
              !steps ? (
                <div className="flex items-center gap-2.5 rounded-xl border border-brand-blue/20 bg-brand-blue/5 px-3 py-3 text-sm text-slate-700">
                  <BrandPinLoader size="sm" className="shrink-0" />
                  <div>
                    <p className="font-medium text-slate-900">
                      Идёт обход ресурсов…
                    </p>
                    <p className="mt-0.5 text-xs text-slate-600">
                      Обычно 30–90 сек. Экран не завис — ждём ответ скрипта.
                    </p>
                  </div>
                </div>
              ) : null}

              {running &&
              !result &&
              !error &&
              resources.length === 0 &&
              steps ? (
                <div className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                  <span className="relative flex size-1.5 shrink-0">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-blue/50" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-brand-blue" />
                  </span>
                  Живой процесс — шаги обновляются по мере ответа
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
                  <BrandPinLoader size="sm" />
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
              {canUndoLast && onUndoLast && !selectedHistory ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <button
                    type="button"
                    disabled={undoLastPending || running}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-100 disabled:opacity-60"
                    onClick={onUndoLast}
                  >
                    {undoLastPending ? (
                      <BrandPinLoader size="sm" />
                    ) : null}
                    Отменить последнее обогащение
                  </button>
                  {undoLastMessage ? (
                    <p className="mt-2 text-xs text-slate-600">{undoLastMessage}</p>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">
                      Вернёт поля карточки к состоянию до последнего запуска.
                    </p>
                  )}
                </div>
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
                    {(selectedHistory.changed_fields as EnrichRunResult)
                      .reverted_at
                      ? " · отменено"
                      : ""}
                  </p>
                  {selectedHistory.note ? (
                    <p className="text-sm text-slate-700">
                      {selectedHistory.note}
                    </p>
                  ) : null}
                  {canUndoLast &&
                  onUndoLast &&
                  history?.[0]?.id === selectedHistory.id &&
                  !(selectedHistory.changed_fields as EnrichRunResult)
                    .reverted_at ? (
                    <button
                      type="button"
                      disabled={undoLastPending || running}
                      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-100 disabled:opacity-60"
                      onClick={onUndoLast}
                    >
                      {undoLastPending ? (
                        <BrandPinLoader size="sm" />
                      ) : null}
                      Отменить это обогащение
                    </button>
                  ) : null}
                  {undoLastMessage && history?.[0]?.id === selectedHistory.id ? (
                    <p className="text-xs text-slate-600">{undoLastMessage}</p>
                  ) : null}
                  <HistoryFieldList
                    result={
                      selectedHistory.changed_fields as EnrichRunResult
                    }
                    runId={selectedHistory.id}
                    onRevertFields={onRevertFields}
                    revertPending={revertFieldsPending}
                    disabled={running}
                  />
                  {revertFieldsMessage ? (
                    <p className="text-xs text-slate-600">{revertFieldsMessage}</p>
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
                    const reverted = Boolean(
                      (row.changed_fields as EnrichRunResult).reverted_at,
                    );
                    const revertedFields =
                      (row.changed_fields as EnrichRunResult).reverted_fields ??
                      [];
                    const activeKeys = patchKeys.filter(
                      (k) => !revertedFields.includes(k),
                    );
                    return (
                      <li key={row.id}>
                        <button
                          type="button"
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-slate-300 hover:bg-slate-50"
                          onClick={() => onSelectHistory(row)}
                        >
                          <p className="text-sm font-medium text-slate-900">
                            {formatWhen(row.created_at)}
                            {reverted ? (
                              <span className="ml-2 text-xs font-normal text-slate-500">
                                отменено
                              </span>
                            ) : revertedFields.length > 0 ? (
                              <span className="ml-2 text-xs font-normal text-slate-500">
                                частично
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {row.note ||
                              (activeKeys.length
                                ? `+${activeKeys.join(", ")}`
                                : patchKeys.length
                                  ? "поля сняты"
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
            {running && onStop ? (
              <Button type="button" variant="secondary" onClick={onStop}>
                Остановить
              </Button>
            ) : (
              <Button
                type="button"
                disabled={startDisabled || running}
                onClick={onStart}
              >
                Запустить снова
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              disabled={running}
              onClick={onClose}
            >
              Закрыть
            </Button>
          </div>
          {running ? (
            <p className="mt-2 text-xs text-slate-500">
              Остановка прервёт обход и откатит уже записанные поля.
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
