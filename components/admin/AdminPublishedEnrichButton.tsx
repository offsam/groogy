"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { History, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { EnrichProgressDrawer } from "@/components/admin/EnrichProgressDrawer";
import { listPublishedEnrichHistoryAction } from "@/lib/admin/published-enrich-actions";
import type { PublishedEnrichKind } from "@/lib/admin/published-enrich-run";
import {
  applyResourceEvent,
  resourcesFromResult,
  type EnrichHistoryRow,
  type EnrichResourceState,
  type EnrichRunResult,
  type EnrichStepId,
  type EnrichStepState,
  type EnrichStreamEvent,
} from "@/lib/import-review/enrich-progress";

/** Published cards run the resource crawl, then the description parser. */
const PUBLISHED_STEPS = ["cleanup"] as const satisfies readonly EnrichStepId[];

type Props = {
  kind: PublishedEnrichKind;
  entityId: string;
  /** Required for business/professional/event/job; optional for listings. */
  slug?: string;
  className?: string;
};

export function AdminPublishedEnrichButton({
  kind,
  entityId,
  slug = "",
  className,
}: Props) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"run" | "history">("run");
  const [running, setRunning] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EnrichRunResult | null>(null);
  const [resources, setResources] = useState<EnrichResourceState[]>([]);
  const [steps, setSteps] = useState<Record<
    EnrichStepId,
    EnrichStepState
  > | null>(null);
  const [history, setHistory] = useState<EnrichHistoryRow[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedHistory, setSelectedHistory] =
    useState<EnrichHistoryRow | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    const res = await listPublishedEnrichHistoryAction(kind, entityId);
    setHistoryLoading(false);
    if (!res.ok) {
      setHistoryError(res.message);
      return;
    }
    setHistory(res.rows);
  }, [kind, entityId]);

  async function startEnrich() {
    if (running) return;
    setOpen(true);
    setTab("run");
    setRunning(true);
    setError(null);
    setResult(null);
    setLabel(null);
    setResources([]);
    setSteps(null);
    setSelectedHistory(null);

    try {
      const res = await fetch("/api/admin/published/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          id: entityId,
          ...(slug ? { slug } : {}),
        }),
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
          } else if (event.type === "step") {
            const step = event.step as EnrichStepId;
            setSteps((prev) => ({
              ...(prev ?? ({} as Record<EnrichStepId, EnrichStepState>)),
              [step]: {
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
            setRunning(false);
            if (event.result?.reason && !event.result.patch) {
              setLabel(event.result.reason);
            }
          }
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
          disabled={running}
          type="button"
          onClick={() => void startEnrich()}
        >
          {running ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
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

      <EnrichProgressDrawer
        open={open}
        mounted={mounted}
        eyebrow="Карточка на платформе"
        title={slug || entityId}
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
        onClose={closePanel}
      />
    </>
  );
}
