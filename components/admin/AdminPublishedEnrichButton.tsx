"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { History, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { EnrichProgressDrawer } from "@/components/admin/EnrichProgressDrawer";
import { listPublishedEnrichHistoryAction, undoLastPublishedEnrichAction, revertPublishedEnrichFieldsAction, applyEnrichFieldConflictsAction, applyPublishedEnrichSelectionAction } from "@/lib/admin/published-enrich-actions";
import type { PublishedEnrichKind } from "@/lib/admin/published-enrich-run";
import {
  listPrePublishEnrichHistoryAction,
  revertPrePublishEnrichFieldsAction,
} from "@/lib/import-review/enrich-actions";
import {
  applyResourceEvent,
  resourcesFromResult,
  type EnrichConflictAction,
  type EnrichHistoryRow,
  type EnrichResourceState,
  type EnrichRunResult,
  type EnrichStepId,
  type EnrichStepState,
  type EnrichStreamEvent,
} from "@/lib/import-review/enrich-progress";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

/** Published cards run the resource crawl, then the description parser. */
const PUBLISHED_STEPS = [
  "resources",
  "cleanup",
] as const satisfies readonly EnrichStepId[];

export type AdminEnrichQueueTarget = {
  source: "import_review" | "recommendation";
  id: string;
};

type Props = {
  kind: PublishedEnrichKind;
  entityId: string;
  /** Required for business/professional/event/job; optional for listings. */
  slug?: string;
  className?: string;
  /**
   * Review/queue preview: same chips + drawer as live, writes the queue row.
   */
  queue?: AdminEnrichQueueTarget;
  /** Called after a successful enrich stream (so preview can remount data). */
  onEnriched?: () => void;
  disabled?: boolean;
};

export function AdminPublishedEnrichButton({
  kind,
  entityId,
  slug = "",
  className,
  queue,
  onEnriched,
  disabled,
}: Props) {
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"run" | "history">("run");
  const [running, setRunning] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EnrichRunResult | null>(null);
  const [resources, setResources] = useState<EnrichResourceState[]>([]);
  const [steps, setSteps] = useState<Partial<
    Record<EnrichStepId, EnrichStepState>
  > | null>(null);
  const [history, setHistory] = useState<EnrichHistoryRow[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedHistory, setSelectedHistory] =
    useState<EnrichHistoryRow | null>(null);
  const [undoPending, setUndoPending] = useState(false);
  const [undoMessage, setUndoMessage] = useState<string | null>(null);
  const [revertPending, setRevertPending] = useState(false);
  const [revertMessage, setRevertMessage] = useState<string | null>(null);
  const [conflictPending, setConflictPending] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const queueId = queue?.id ?? entityId;
  const isQueue = Boolean(queue);
  const supportsHistoryUndo = !queue || queue.source === "import_review";

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    if (queue?.source === "recommendation") {
      setHistory([]);
      setHistoryLoading(false);
      return;
    }
    if (queue?.source === "import_review") {
      const res = await listPrePublishEnrichHistoryAction(queue.id);
      setHistoryLoading(false);
      if (!res.ok) {
        setHistoryError(res.message);
        return;
      }
      setHistory(res.rows);
      return;
    }
    const res = await listPublishedEnrichHistoryAction(kind, entityId);
    setHistoryLoading(false);
    if (!res.ok) {
      setHistoryError(res.message);
      return;
    }
    setHistory(res.rows);
  }, [kind, entityId, queue]);

  const canUndoLast = Boolean(
    supportsHistoryUndo &&
      history?.some((row) => !(row.changed_fields as EnrichRunResult).reverted_at),
  );

  async function undoLast() {
    if (undoPending || running || !supportsHistoryUndo || isQueue) return;
    setUndoPending(true);
    setUndoMessage(null);
    const res = await undoLastPublishedEnrichAction(kind, entityId);
    setUndoPending(false);
    if (!res.ok) {
      setUndoMessage(res.message);
      return;
    }
    setUndoMessage(res.message);
    setSelectedHistory(null);
    await loadHistory();
    router.refresh();
    onEnriched?.();
  }

  async function revertFields(runId: string, fields: string[]) {
    if (revertPending || running || !fields.length) return;
    setRevertPending(true);
    setRevertMessage(null);
    const res =
      queue?.source === "import_review"
        ? await revertPrePublishEnrichFieldsAction(queue.id, runId, fields)
        : queue
          ? { ok: false as const, message: "Откат для этой очереди пока недоступен" }
          : await revertPublishedEnrichFieldsAction(
              kind,
              entityId,
              runId,
              fields,
            );
    setRevertPending(false);
    if (!res.ok) {
      setRevertMessage(res.message);
      return;
    }
    setRevertMessage(res.message);
    await loadHistory();
    setSelectedHistory((prev) => {
      if (!prev || prev.id !== runId) return prev;
      return null;
    });
    if (!queue) {
      const refreshed = await listPublishedEnrichHistoryAction(kind, entityId);
      if (refreshed.ok) {
        const next = refreshed.rows.find((r) => r.id === runId) ?? null;
        setSelectedHistory(next);
        setHistory(refreshed.rows);
      }
    } else if (queue.source === "import_review") {
      const refreshed = await listPrePublishEnrichHistoryAction(queue.id);
      if (refreshed.ok) {
        setSelectedHistory(refreshed.rows.find((r) => r.id === runId) ?? null);
        setHistory(refreshed.rows);
      }
    }
    router.refresh();
    onEnriched?.();
  }

  async function applyConflicts(actions: EnrichConflictAction[]) {
    if (conflictPending || running || !result?.field_conflicts?.length) {
      return;
    }
    // All leave: dismiss conflicts without writing.
    if (!actions.length) {
      setConflictMessage("Оставлено без изменений");
      setResult((prev) =>
        prev ? { ...prev, field_conflicts: [] } : prev,
      );
      return;
    }
    setConflictPending(true);
    setConflictMessage(null);
    const res = await applyEnrichFieldConflictsAction({
      kind,
      entityId,
      actions,
      conflicts: result.field_conflicts,
      queue,
    });
    setConflictPending(false);
    if (!res.ok) {
      setConflictMessage(res.message);
      return;
    }
    setConflictMessage(res.message);
    setResult((prev) =>
      prev ? { ...prev, field_conflicts: [] } : prev,
    );
    router.refresh();
    onEnriched?.();
  }

  async function saveSelection(input: {
    selectedKeys: string[];
    selectedConflictKeys: string[];
  }) {
    if (savePending || running || !result?.pending_review || isQueue) return;
    setSavePending(true);
    setSaveMessage(null);
    const res = await applyPublishedEnrichSelectionAction({
      kind,
      entityId,
      selectedKeys: input.selectedKeys,
      selectedConflictKeys: input.selectedConflictKeys,
      patch: result.patch ?? {},
      conflicts: result.field_conflicts,
      extraAddresses: result.extra_addresses,
      result,
    });
    setSavePending(false);
    if (!res.ok) {
      setSaveMessage(res.message);
      return;
    }
    setSaveMessage(res.message);
    setResult((prev) =>
      prev
        ? {
            ...prev,
            pending_review: false,
            patch: Object.fromEntries(
              input.selectedKeys
                .filter(
                  (k) =>
                    k !== "locations" &&
                    k !== "jobs" &&
                    prev.patch &&
                    k in prev.patch,
                )
                .map((k) => [k, prev.patch![k]]),
            ),
            field_conflicts: (prev.field_conflicts ?? []).filter(
              (c) => !input.selectedConflictKeys.includes(c.key),
            ),
            reason: null,
          }
        : prev,
    );
    router.refresh();
    onEnriched?.();
    await loadHistory();
  }

  function stopEnrich() {
    abortRef.current?.abort();
  }

  async function startEnrich() {
    if (running || disabled) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setOpen(true);
    setTab("run");
    setRunning(true);
    setError(null);
    setResult(null);
    setLabel("Подключение… обогащение запущено");
    setResources([]);
    setSteps({
      resources: {
        status: "running",
        detail: "Обход сайта / Instagram / источника… обычно 30–90 сек",
      },
      cleanup: { status: "pending", detail: "ожидает…" },
    });
    setSelectedHistory(null);

    try {
      const res = await fetch("/api/admin/published/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          id: queue?.id || entityId,
          ...(slug && !queue ? { slug } : {}),
          ...(queue ? { queue } : {}),
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(data?.message || `Ошибка ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let event: EnrichStreamEvent;
          try {
            event = JSON.parse(trimmed) as EnrichStreamEvent;
          } catch {
            continue;
          }
          if (event.type === "started" && event.label) {
            setLabel(event.label);
          } else if (event.type === "resource") {
            setResources((prev) => applyResourceEvent(prev, event));
            setSteps((prev) => ({
              ...(prev ?? {}),
              resources: {
                status: "running",
                detail: "Получаем ответы по ссылкам…",
              },
            }));
          } else if (event.type === "step") {
            const rawStep = String(event.step || "");
            const uiStep: EnrichStepId =
              rawStep === "bfs" ? "resources" : (rawStep as EnrichStepId);
            setSteps((prev) => ({
              ...(prev ?? {}),
              [uiStep]: {
                status: event.status as EnrichStepState["status"],
                detail: event.detail,
                found: event.found,
              },
            }));
          } else if (event.type === "error") {
            setError(event.message || "Ошибка обогащения");
            setRunning(false);
          } else if (event.type === "finished") {
            setResult(event.result);
            setResources((prev) => {
              const fromResult = resourcesFromResult(event.result);
              return fromResult.length > 0 ? fromResult : prev;
            });
            setSteps((prev) => ({
              ...(prev ?? {}),
              resources: {
                status: "done",
                detail: "Обход завершён",
              },
            }));
            setRunning(false);
            if (event.result?.reason && !event.result.patch) {
              setLabel(event.result.reason);
            }
          }
        }
      }
      if (ac.signal.aborted) {
        setError("Остановлено");
        setLabel("Остановлено");
        setResult(null);
      } else if (!isQueue) {
        // Dry-run: wait for Save — do not refresh the card yet.
        void loadHistory();
      } else {
        router.refresh();
        onEnriched?.();
        void loadHistory();
      }
    } catch (err) {
      if (
        ac.signal.aborted ||
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        setError("Остановлено");
        setLabel("Остановлено");
        setResult(null);
      } else {
        setError(err instanceof Error ? err.message : "Не удалось обогатить");
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setRunning(false);
    }
  }

  function openHistory() {
    setOpen(true);
    setTab("history");
    setSelectedHistory(null);
    setUndoMessage(null);
    setRevertMessage(null);
    void loadHistory();
  }

  function closePanel() {
    if (running) return;
    setOpen(false);
  }

  return (
    <>
      <div className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
        <button
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
          disabled={running || disabled}
          type="button"
          onClick={() => void startEnrich()}
        >
          {running ? (
            <BrandPinLoader size="sm" />
          ) : (
            <Sparkles aria-hidden className="size-3.5" />
          )}
          {running ? "Обогащение…" : "Обогатить"}
        </button>
        {running ? (
          <button
            className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50"
            type="button"
            onClick={stopEnrich}
          >
            Остановить
          </button>
        ) : (
          <button
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
            type="button"
            onClick={openHistory}
          >
            <History aria-hidden className="size-3.5" />
            История
          </button>
        )}
      </div>

      <EnrichProgressDrawer
        open={open}
        mounted={mounted}
        eyebrow="Карточка на платформе"
        title={slug || queueId}
        tab={tab}
        onTabChange={setTab}
        running={running}
        label={label}
        error={error}
        result={result}
        steps={steps}
        stepOrder={PUBLISHED_STEPS}
        resources={resources}
        history={history}
        historyLoading={historyLoading}
        historyError={historyError}
        selectedHistory={selectedHistory}
        onSelectHistory={setSelectedHistory}
        onLoadHistory={() => void loadHistory()}
        onStart={() => void startEnrich()}
        onStop={queue?.source === "recommendation" ? undefined : stopEnrich}
        onClose={closePanel}
        startDisabled={disabled}
        onUndoLast={
          supportsHistoryUndo && !isQueue ? () => void undoLast() : undefined
        }
        undoLastPending={undoPending}
        undoLastMessage={undoMessage}
        canUndoLast={canUndoLast}
        onRevertFields={
          supportsHistoryUndo
            ? (runId, fields) => void revertFields(runId, fields)
            : undefined
        }
        revertFieldsPending={revertPending}
        revertFieldsMessage={revertMessage}
        onApplyConflicts={(actions) => void applyConflicts(actions)}
        applyConflictsPending={conflictPending}
        applyConflictsMessage={conflictMessage}
        conflictEntityKind={queue ? "queue" : kind}
        onSaveSelection={
          isQueue ? undefined : (sel) => void saveSelection(sel)
        }
        saveSelectionPending={savePending}
        saveSelectionMessage={saveMessage}
      />
    </>
  );
}
