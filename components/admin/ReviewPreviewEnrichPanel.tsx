"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { History, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EnrichProgressDrawer } from "@/components/admin/EnrichProgressDrawer";
import { listPrePublishEnrichHistoryAction, revertPrePublishEnrichFieldsAction } from "@/lib/import-review/enrich-actions";
import {
  ENRICH_STEP_LABELS,
  applyResourceEvent,
  emptyEnrichSteps,
  resourcesFromResult,
  type EnrichHistoryRow,
  type EnrichResourceState,
  type EnrichRunResult,
  type EnrichStepId,
  type EnrichStepState,
  type EnrichStreamEvent,
} from "@/lib/import-review/enrich-progress";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

type Props = {
  itemId: string;
  disabled?: boolean;
  /** `lens` = same chips as live AdminPublishedEnrichButton (for AdminLensBar). */
  variant?: "default" | "lens";
};

export function ReviewPreviewEnrichPanel({
  itemId,
  disabled,
  variant = "default",
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"run" | "history">("run");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState(emptyEnrichSteps);
  const [resources, setResources] = useState<EnrichResourceState[]>([]);
  const [result, setResult] = useState<EnrichRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [history, setHistory] = useState<EnrichHistoryRow[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedHistory, setSelectedHistory] =
    useState<EnrichHistoryRow | null>(null);
  const [mounted, setMounted] = useState(false);
  const [revertPending, setRevertPending] = useState(false);
  const [revertMessage, setRevertMessage] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    const res = await listPrePublishEnrichHistoryAction(itemId);
    setHistoryLoading(false);
    if (!res.ok) {
      setHistoryError(res.message);
      return;
    }
    setHistory(res.rows);
  }, [itemId]);

  async function startEnrich() {
    if (running || disabled) return;
    setOpen(true);
    setTab("run");
    setRunning(true);
    setError(null);
    setResult(null);
    setLabel(null);
    setSteps(emptyEnrichSteps());
    setResources([]);
    setSelectedHistory(null);

    try {
      const res = await fetch("/api/admin/import-review/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
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
        const { done, value } = await reader.read();
        if (done) break;
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
          if (event.type === "started") {
            setLabel(event.label);
          } else if (event.type === "resource") {
            setResources((prev) => applyResourceEvent(prev, event));
          } else if (event.type === "step") {
            const step = event.step as EnrichStepId;
            if (!(step in ENRICH_STEP_LABELS)) continue;
            setSteps((prev) => ({
              ...prev,
              [step]: {
                status: (event.status as EnrichStepState["status"]) || "done",
                detail: event.detail,
                found: event.found,
                directory_match: event.directory_match,
                score_before: event.score_before,
                score_after: event.score_after,
              },
            }));
          } else if (event.type === "finished") {
            setResult(event.result);
            setResources((prev) => {
              const fromResult = resourcesFromResult(event.result);
              return fromResult.length > 0 ? fromResult : prev;
            });
            setRunning(false);
          } else if (event.type === "error") {
            setError(event.message);
            setRunning(false);
          }
        }
      }
      if (buf.trim()) {
        try {
          const event = JSON.parse(buf.trim()) as EnrichStreamEvent;
          if (event.type === "finished") {
            setResult(event.result);
            setRunning(false);
          }
          if (event.type === "error") {
            setError(event.message);
            setRunning(false);
          }
        } catch {
          /* ignore */
        }
      }
      router.refresh();
      void loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось обогатить");
    } finally {
      setRunning(false);
    }
  }

  function openHistory() {
    setOpen(true);
    setTab("history");
    setSelectedHistory(null);
    setRevertMessage(null);
    void loadHistory();
  }

  async function revertFields(runId: string, fields: string[]) {
    if (revertPending || running || !fields.length) return;
    setRevertPending(true);
    setRevertMessage(null);
    const res = await revertPrePublishEnrichFieldsAction(itemId, runId, fields);
    setRevertPending(false);
    if (!res.ok) {
      setRevertMessage(res.message);
      return;
    }
    setRevertMessage(res.message);
    const refreshed = await listPrePublishEnrichHistoryAction(itemId);
    if (refreshed.ok) {
      setHistory(refreshed.rows);
      setSelectedHistory(refreshed.rows.find((r) => r.id === runId) ?? null);
    } else {
      await loadHistory();
      setSelectedHistory(null);
    }
    router.refresh();
  }

  function closePanel() {
    if (running) return;
    setOpen(false);
  }

  return (
    <>
      {variant === "lens" ? (
        <div className="inline-flex flex-wrap items-center gap-1.5">
          <button
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
            disabled={disabled || running}
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
          <button
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
            type="button"
            onClick={openHistory}
          >
            <History aria-hidden className="size-3.5" />
            История
          </button>
        </div>
      ) : (
        <div className="relative z-10 flex w-full min-w-0 flex-wrap gap-2 sm:w-auto">
          <Button
            type="button"
            disabled={disabled || running}
            variant="secondary"
            className="min-h-10 w-full max-sm:flex-1 sm:min-h-0 sm:w-auto sm:flex-none"
            onClick={() => void startEnrich()}
          >
            {running ? (
              <>
                <BrandPinLoader size="sm" className="mr-2" />
                <span className="sm:hidden">…</span>
                <span className="hidden sm:inline">Обогащение…</span>
              </>
            ) : (
              <>
                <Sparkles className="mr-2 size-4" />
                Обогатить
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-h-10 w-full max-sm:flex-1 sm:min-h-0 sm:w-auto sm:flex-none"
            onClick={openHistory}
          >
            <History className="mr-1.5 size-4" />
            История
          </Button>
        </div>
      )}
      <EnrichProgressDrawer
        open={open}
        mounted={mounted}
        eyebrow="Pre-publish enrich"
        subtitle="Без LLM · текст · сайт · справочники · маршрут URL"
        tab={tab}
        onTabChange={setTab}
        running={running}
        label={label}
        error={error}
        result={result}
        steps={steps}
        resources={resources}
        history={history}
        historyLoading={historyLoading}
        historyError={historyError}
        selectedHistory={selectedHistory}
        onSelectHistory={setSelectedHistory}
        onLoadHistory={() => void loadHistory()}
        onStart={() => void startEnrich()}
        onClose={closePanel}
        startDisabled={disabled}
        onRevertFields={(runId, fields) => void revertFields(runId, fields)}
        revertFieldsPending={revertPending}
        revertFieldsMessage={revertMessage}
      />
    </>
  );
}
