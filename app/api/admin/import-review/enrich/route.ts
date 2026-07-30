import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import {
  spawnPrePublishEnrichNdjson,
  writePrePublishEnrichAudit,
} from "@/lib/import-review/enrich-run";
import { finalizePrePublishEnrich } from "@/lib/import-review/finalize-enrich";
import type {
  EnrichRunResult,
  EnrichStreamEvent,
} from "@/lib/import-review/enrich-progress";
import type { ImportReviewStatus } from "@/types/import-review";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Body = { itemId?: string };

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ message: "Нужна авторизация" }, { status: 401 });
  }
  if (!(await userIsAdmin(supabase))) {
    return NextResponse.json({ message: "Только для админов" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ message: "Некорректный JSON" }, { status: 400 });
  }
  const itemId = (body.itemId || "").trim();
  if (!itemId || !isUuid(itemId)) {
    return NextResponse.json({ message: "Нужен itemId" }, { status: 400 });
  }

  const { data: row, error: loadError } = await supabase
    .from("import_review_items")
    .select("id, review_status, published_entity_id")
    .eq("id", itemId)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ message: loadError.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ message: "Карточка не найдена" }, { status: 404 });
  }
  if (row.published_entity_id) {
    return NextResponse.json(
      { message: "Карточка уже опубликована — pre-publish enrich недоступен" },
      { status: 409 },
    );
  }
  const open = new Set([
    "pending",
    "in_review",
    "needs_more_info",
    "ready_to_publish",
  ]);
  if (!open.has(row.review_status)) {
    return NextResponse.json(
      { message: `Статус ${row.review_status} нельзя обогащать` },
      { status: 409 },
    );
  }

  const previousStatus = row.review_status as ImportReviewStatus;
  const encoder = new TextEncoder();
  const { child } = spawnPrePublishEnrichNdjson(itemId);

  let finishedResult: EnrichRunResult | null = null;
  let stderrBuf = "";

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const pushLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const event = JSON.parse(trimmed) as EnrichStreamEvent;
          if (event.type === "finished") {
            finishedResult = event.result;
            // Hold the Python "finished" until after TS cleanup so the UI
            // sees the cleanup step and the final result together.
            return;
          }
        } catch {
          return;
        }
        controller.enqueue(encoder.encode(`${trimmed}\n`));
      };

      let stdoutBuf = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutBuf += chunk.toString("utf8");
        const parts = stdoutBuf.split("\n");
        stdoutBuf = parts.pop() ?? "";
        for (const part of parts) pushLine(part);
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString("utf8");
      });

      child.on("error", (err) => {
        const message =
          err.message.includes("ENOENT")
            ? "python3 не найден — обогащение из UI работает на машине с Python и .env"
            : err.message;
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({ type: "error", message } satisfies EnrichStreamEvent)}\n`,
          ),
        );
        controller.close();
      });

      child.on("close", async (code) => {
        if (stdoutBuf.trim()) pushLine(stdoutBuf);
        if (!finishedResult && code !== 0) {
          const message =
            stderrBuf.trim().slice(0, 400) ||
            `Скрипт завершился с кодом ${code ?? "?"}`;
          controller.enqueue(
            encoder.encode(
              `${JSON.stringify({ type: "error", message } satisfies EnrichStreamEvent)}\n`,
            ),
          );
        } else if (finishedResult) {
          controller.enqueue(
            encoder.encode(
              `${JSON.stringify({
                type: "step",
                id: itemId,
                step: "cleanup",
                status: "running",
                detail: "Чистим описание и вытаскиваем услуги",
              } satisfies EnrichStreamEvent)}\n`,
            ),
          );
          const finalized = await finalizePrePublishEnrich(
            supabase,
            itemId,
            finishedResult,
          );
          finishedResult = finalized.result;
          controller.enqueue(
            encoder.encode(
              `${JSON.stringify({
                type: "step",
                id: itemId,
                step: "cleanup",
                status: "done",
                found: finalized.found,
                detail: finalized.found.length
                  ? `Заполнено: ${finalized.found.join(", ")}`
                  : "Новых полей нет",
              } satisfies EnrichStreamEvent)}\n`,
            ),
          );
          controller.enqueue(
            encoder.encode(
              `${JSON.stringify({
                type: "finished",
                result: finishedResult,
              } satisfies EnrichStreamEvent)}\n`,
            ),
          );

          const newStatus = (finishedResult.new_status ||
            previousStatus) as ImportReviewStatus;
          await writePrePublishEnrichAudit({
            itemId,
            result: finishedResult,
            previousStatus,
            newStatus,
          });
          revalidatePath("/admin/review");
          revalidatePath(`/admin/review/${itemId}`);
          revalidatePath(
            `/admin/review/${encodeURIComponent(`import_review:${itemId}`)}`,
          );
        }
        controller.close();
      });
    },
    cancel() {
      child.kill("SIGTERM");
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
