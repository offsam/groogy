import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { userIsAdmin } from "@/lib/reviews/queries";
import {
  spawnPublishedEnrich,
  type PublishedEnrichKind,
  type PublishedEnrichQueueTarget,
} from "@/lib/admin/published-enrich-run";
import { resolvePythonBin } from "@/lib/admin/resolve-python";
import { attachEnrichBeforeSnapshot, restoreEntityEnrichSnapshot } from "@/lib/admin/published-enrich-history";
import {
  finalizePublishedEnrich,
  isFinalizableKind,
} from "@/lib/admin/published-finalize-enrich";
import { finalizePrePublishEnrich } from "@/lib/import-review/finalize-enrich";
import { peelRecommendationQueueAddress } from "@/lib/import-review/recommendation-enrich";
import { fieldLabel } from "@/lib/import-review/enrich-progress";
import type {
  EnrichRunResult,
  EnrichStreamEvent,
} from "@/lib/import-review/enrich-progress";

/** Dynamic table names are not in the hand Database union yet. */
function untyped(client: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client as unknown as SupabaseClient<any>;
}

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Body = {
  kind?: PublishedEnrichKind;
  id?: string;
  slug?: string;
  queue?: PublishedEnrichQueueTarget;
};

const SECTION_TITLES: Record<string, string> = {
  businesses: "Бизнесы",
  private_specialists: "Специалисты",
  marketplace: "Купи-продай",
  jobs: "Работа",
  events: "События",
  lechu: "Лечу",
  transfers: "Переводы",
  real_estate: "Недвижимость",
  organizations: "Организации",
  services: "Услуги",
};

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

  const kind = body.kind;
  const allowed = [
    "business",
    "professional",
    "event",
    "service",
    "job",
    "transfer",
    "marketplace",
    "lechu",
  ] as const;
  if (!kind || !allowed.includes(kind as (typeof allowed)[number])) {
    return NextResponse.json(
      {
        message:
          "kind: business | professional | event | service | job | transfer | marketplace | lechu",
      },
      { status: 400 },
    );
  }

  const queue = body.queue;
  if (
    queue &&
    (queue.source !== "import_review" && queue.source !== "recommendation")
  ) {
    return NextResponse.json(
      { message: "queue.source: import_review | recommendation" },
      { status: 400 },
    );
  }
  if (queue && (!queue.id || !isUuid(queue.id))) {
    return NextResponse.json({ message: "Нужен queue.id" }, { status: 400 });
  }

  let slug = (body.slug || "").trim();
  let id = (body.id || "").trim();
  const listingKind = ["service", "transfer", "marketplace", "lechu"].includes(
    kind,
  );

  if (!queue) {
    if (listingKind) {
      if (!id || !isUuid(id)) {
        return NextResponse.json(
          { message: "Для объявления нужен id" },
          { status: 400 },
        );
      }
    } else if (!id && slug) {
      const catalog = untyped(createServiceRoleClient());
      const table =
        kind === "business"
          ? "businesses"
          : kind === "professional"
            ? "professionals"
            : kind === "event"
              ? "events"
              : "jobs";
      const { data, error } = await catalog
        .from(table)
        .select("id, slug")
        .eq("slug", slug)
        .maybeSingle();
      if (error) {
        return NextResponse.json({ message: error.message }, { status: 500 });
      }
      if (!data?.id) {
        return NextResponse.json({ message: "Карточка не найдена" }, { status: 404 });
      }
      id = String((data as { id: string }).id);
      slug = String((data as { slug?: string }).slug || slug);
    } else if (id && !slug) {
      if (!isUuid(id)) {
        return NextResponse.json({ message: "Некорректный id" }, { status: 400 });
      }
      const catalog = untyped(createServiceRoleClient());
      const table =
        kind === "business"
          ? "businesses"
          : kind === "professional"
            ? "professionals"
            : kind === "event"
              ? "events"
              : "jobs";
      const { data, error } = await catalog
        .from(table)
        .select("id, slug")
        .eq("id", id)
        .maybeSingle();
      if (error) {
        return NextResponse.json({ message: error.message }, { status: 500 });
      }
      if (!data) {
        return NextResponse.json({ message: "Карточка не найдена" }, { status: 404 });
      }
      slug = String((data as { slug?: string }).slug || "");
    }

    if (!id && !slug) {
      return NextResponse.json({ message: "Нужен slug или id" }, { status: 400 });
    }
  } else {
    id = queue.id;
    slug = slug || queue.id;
  }

  const tableByKind: Record<string, string> = {
    business: "businesses",
    professional: "professionals",
    event: "events",
    job: "jobs",
    service: "listings",
    transfer: "listings",
    marketplace: "listings",
    lechu: "listings",
  };
  let beforeSnapshot: Record<string, unknown> | null = null;
  if (!queue && id && tableByKind[kind as string]) {
    const catalog = untyped(createServiceRoleClient());
    const { data: snap } = await catalog
      .from(tableByKind[kind as string])
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (snap && typeof snap === "object") {
      beforeSnapshot = snap as Record<string, unknown>;
    }
  }

  const encoder = new TextEncoder();
  let child: ReturnType<typeof spawnPublishedEnrich>["child"];
  try {
    child = spawnPublishedEnrich({
      kind: kind as PublishedEnrichKind,
      slug: slug || undefined,
      id: id || undefined,
      queue: queue || undefined,
      mode: queue ? "apply" : "dry-run",
    }).child;
  } catch (err) {
    return NextResponse.json(
      {
        message:
          err instanceof Error ? err.message : "Не удалось запустить обогащение",
      },
      { status: 400 },
    );
  }

  const supportsNdjson = true;
  let stderrBuf = "";
  let stdoutBuf = "";
  let finishedResult: EnrichRunResult | null = null;
  let sawNdjson = false;
  let aborted = false;
  const entityTable = queue ? "" : tableByKind[kind as string] || "";

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (obj: Record<string, unknown>) => {
        if (aborted) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          // Controller already closed (client aborted).
        }
      };

      const labels: Record<string, string> = {
        business: `Обогащение бизнеса «${slug || id}»`,
        professional: `Обогащение специалиста «${slug || id}»`,
        event: `Обогащение события «${slug || id}»`,
        service: `Обогащение услуги`,
        job: `Обогащение вакансии «${slug || id}»`,
        transfer: `Обогащение перевода`,
        marketplace: `Обогащение объявления`,
        lechu: `Обогащение поездки`,
      };

      const rollbackAbort = async () => {
        if (!id || !entityTable || !beforeSnapshot) return;
        try {
          await restoreEntityEnrichSnapshot({
            table: entityTable,
            entityId: id,
            snapshot: beforeSnapshot,
          });
        } catch (err) {
          console.error("enrich abort rollback failed", err);
        }
      };

      let lastPushAt = Date.now();
      const markPushed = () => {
        lastPushAt = Date.now();
      };
      const pushTracked = (obj: Record<string, unknown>) => {
        push(obj);
        markPushed();
      };

      // Always ack immediately (ndjson mode previously stayed silent until Python spoke).
      pushTracked({
        type: "started",
        label: labels[kind] || `Обогащение «${slug || id}»`,
      });
      pushTracked({
        type: "step",
        step: "bfs",
        status: "running",
        detail: "Обход ресурсов… обычно 30–90 сек",
      });

      const keepAlive = setInterval(() => {
        if (aborted) return;
        if (Date.now() - lastPushAt < 12_000) return;
        try {
          controller.enqueue(encoder.encode("\n"));
          markPushed();
        } catch {
          /* closed */
        }
      }, 8_000);

      const pushLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const event = JSON.parse(trimmed) as EnrichStreamEvent;
          sawNdjson = true;
          if (event.type === "finished") {
            finishedResult = event.result;
          }
          if (!aborted) {
            controller.enqueue(encoder.encode(`${trimmed}\n`));
            markPushed();
          }
        } catch {
          // non-json human log — ignore for UI when ndjson mode
        }
      };

      let lineBuf = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stdoutBuf += text;
        if (!supportsNdjson || aborted) return;
        lineBuf += text;
        const parts = lineBuf.split("\n");
        lineBuf = parts.pop() ?? "";
        for (const part of parts) pushLine(part);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString("utf8");
      });

      child.on("error", (err) => {
        clearInterval(keepAlive);
        if (aborted) {
          void rollbackAbort().finally(() => {
            try {
              controller.close();
            } catch {
              /* closed */
            }
          });
          return;
        }
        const message = err.message.includes("ENOENT")
          ? `Python не найден (${resolvePythonBin()}). Нужен python3 в PATH или PYTHON=/путь/к/python.`
          : err.message;
        push({ type: "error", message });
        try {
          controller.close();
        } catch {
          /* closed */
        }
      });

      child.on("close", (code) => {
        clearInterval(keepAlive);
        void (async () => {
          if (aborted) {
            await rollbackAbort();
            push({
              type: "error",
              message: "Остановлено — изменения отменены",
            });
            try {
              controller.close();
            } catch {
              /* closed */
            }
            return;
          }

          if (supportsNdjson && lineBuf.trim()) {
            pushLine(lineBuf);
            lineBuf = "";
          }

          const combined = `${stderrBuf}\n${stdoutBuf}`.trim();
          if (code !== 0) {
            const message =
              combined.slice(0, 500) ||
              `Скрипт завершился с кодом ${code ?? "?"}`;
            push({ type: "error", message });
            try {
              controller.close();
            } catch {
              /* closed */
            }
            return;
          }

          if (aborted) {
            await rollbackAbort();
            try {
              controller.close();
            } catch {
              /* closed */
            }
            return;
          }

          if (!supportsNdjson || !sawNdjson || !finishedResult) {
            if (!finishedResult) {
              if (supportsNdjson && !sawNdjson) {
                push({
                  type: "started",
                  label: labels[kind] || `Обогащение «${slug || id}»`,
                });
              }
              if (!supportsNdjson) {
                push({ type: "step", step: "bfs", status: "done" });
              }
              const noPatch =
                /→ no patch/i.test(stdoutBuf) ||
                /"with_patch": 0/.test(stdoutBuf) ||
                /новых полей не было/i.test(stdoutBuf);
              finishedResult = {
                id: id || undefined,
                label: labels[kind],
                skipped: false,
                patch: {},
                resources: [],
                resources_ok: 0,
                resources_failed: 0,
                reason: noPatch
                  ? "Готово — новых полей не нашлось (fill-empty)."
                  : null,
              };
              push({ type: "finished", result: finishedResult });
            }
          }

          if (aborted) {
            await rollbackAbort();
            try {
              controller.close();
            } catch {
              /* closed */
            }
            return;
          }

          // Resource crawl is done; now parse the card copy into услуги /
          // акции / обновления and leave «О нас» as narrative.
          // Queue cards already wrote fill-empty via enrich_queue_card.py —
          // skip live finalize (that targets businesses/professionals tables).
          if (!queue && id && isFinalizableKind(kind)) {
            push({
              type: "step",
              step: "cleanup",
              status: "running",
              detail: "Разбор описания…",
            });
            try {
              const catalog = createServiceRoleClient();
              const finalized = await finalizePublishedEnrich(
                catalog,
                kind,
                id,
                finishedResult,
                { dryRun: true },
              );
              if (aborted) {
                await rollbackAbort();
                try {
                  controller.close();
                } catch {
                  /* closed */
                }
                return;
              }
              finishedResult = finalized.result;
              const sectionNote = finalized.sectionMismatch
                ? `похоже на другой раздел: ${SECTION_TITLES[finalized.sectionMismatch] ?? finalized.sectionMismatch} — перенос в «Не тот раздел»`
                : null;
              const parsed = finalized.found.length
                ? finalized.found.map(fieldLabel).join(", ")
                : "в описании нечего разбирать";
              push({
                type: "step",
                step: "cleanup",
                status: "done",
                detail: sectionNote ? `${parsed}; ${sectionNote}` : parsed,
                found: finalized.found,
              });
              push({ type: "finished", result: finishedResult });
            } catch (err) {
              if (aborted) {
                await rollbackAbort();
                try {
                  controller.close();
                } catch {
                  /* closed */
                }
                return;
              }
              push({
                type: "step",
                step: "cleanup",
                status: "error",
                detail: err instanceof Error ? err.message : "Ошибка разбора",
              });
            }
          } else if (queue) {
            // Same peel (+ geo for recommendations) as live finalize — Python
            // crawl alone leaves directory dumps crooked and without a pin.
            push({
              type: "step",
              step: "cleanup",
              status: "running",
              detail: "Адрес и разбор…",
            });
            try {
              const catalog = createServiceRoleClient();
              let found = Object.keys(finishedResult?.patch || {});
              if (queue.source === "import_review") {
                const fin = await finalizePrePublishEnrich(
                  catalog,
                  queue.id,
                  finishedResult,
                );
                finishedResult = fin.result;
                found = [...new Set([...found, ...fin.found])];
              } else {
                const addrFound = await peelRecommendationQueueAddress(
                  catalog,
                  queue.id,
                );
                found = [...new Set([...found, ...addrFound])];
                if (finishedResult && addrFound.length) {
                  finishedResult = {
                    ...finishedResult,
                    patch: {
                      ...(finishedResult.patch || {}),
                      ...Object.fromEntries(
                        addrFound.map((k) => [k, true] as const),
                      ),
                    },
                  };
                }
              }
              push({
                type: "step",
                step: "cleanup",
                status: "done",
                detail: found.length
                  ? found.map(fieldLabel).join(", ")
                  : finishedResult?.patch
                    ? "Очередь обновлена"
                    : "Новых полей нет",
                found,
              });
            } catch (err) {
              push({
                type: "step",
                step: "cleanup",
                status: "error",
                detail:
                  err instanceof Error ? err.message : "Ошибка разбора адреса",
              });
            }
          }

          if (aborted) {
            await rollbackAbort();
            try {
              controller.close();
            } catch {
              /* closed */
            }
            return;
          }

          if (!queue && finishedResult && id) {
            try {
              const historyResult = attachEnrichBeforeSnapshot(
                finishedResult,
                beforeSnapshot,
              );
              Object.assign(finishedResult, historyResult);
              finishedResult.pending_review = true;
              // History is written when admin Saves selected fields — not on dry-run.
            } catch (err) {
              console.error("enrich before snapshot failed", err);
            }
          }

          if (queue) {
            revalidatePath("/admin/review");
            revalidatePath(
              `/admin/review/${encodeURIComponent(
                `${queue.source === "recommendation" ? "recommendation" : "import_review"}:${queue.id}`,
              )}`,
            );
            revalidatePath("/admin/community/recommendations");
          }
          // Published dry-run: no revalidate until Save applies the patch.
          try {
            controller.close();
          } catch {
            /* closed */
          }
        })();
      });
    },
    cancel() {
      aborted = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* already dead */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
