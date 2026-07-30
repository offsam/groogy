import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { userIsAdmin } from "@/lib/reviews/queries";
import {
  spawnPublishedEnrich,
  type PublishedEnrichKind,
} from "@/lib/admin/published-enrich-run";
import { writePublishedEnrichHistory } from "@/lib/admin/published-enrich-history";
import {
  finalizePublishedEnrich,
  isFinalizableKind,
} from "@/lib/admin/published-finalize-enrich";
import { fieldLabel } from "@/lib/import-review/enrich-progress";
import type {
  EnrichRunResult,
  EnrichStreamEvent,
} from "@/lib/import-review/enrich-progress";

/** Dynamic table names are not in the hand Database union yet. */
function untyped(client: SupabaseClient) {
  return client as unknown as SupabaseClient<any>;
}

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Body = {
  kind?: PublishedEnrichKind;
  id?: string;
  slug?: string;
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

  let slug = (body.slug || "").trim();
  let id = (body.id || "").trim();
  const listingKind = ["service", "transfer", "marketplace", "lechu"].includes(
    kind,
  );

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

  const encoder = new TextEncoder();
  let child: ReturnType<typeof spawnPublishedEnrich>["child"];
  try {
    child = spawnPublishedEnrich({
      kind: kind as PublishedEnrichKind,
      slug: slug || undefined,
      id: id || undefined,
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

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
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

      if (!supportsNdjson) {
        push({
          type: "started",
          label: labels[kind] || `Обогащение «${slug || id}»`,
        });
        push({ type: "step", step: "bfs", status: "running", detail: "Обход ресурсов…" });
      }

      const pushLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const event = JSON.parse(trimmed) as EnrichStreamEvent;
          sawNdjson = true;
          if (event.type === "finished") {
            finishedResult = event.result;
          }
          controller.enqueue(encoder.encode(`${trimmed}\n`));
        } catch {
          // non-json human log — ignore for UI when ndjson mode
        }
      };

      let lineBuf = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stdoutBuf += text;
        if (!supportsNdjson) return;
        lineBuf += text;
        const parts = lineBuf.split("\n");
        lineBuf = parts.pop() ?? "";
        for (const part of parts) pushLine(part);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString("utf8");
      });

      child.on("error", (err) => {
        const message = err.message.includes("ENOENT")
          ? "python3 не найден — обогащение из UI работает на машине с Python и .env"
          : err.message;
        push({ type: "error", message });
        controller.close();
      });

      child.on("close", (code) => {
        void (async () => {
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
            controller.close();
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

          // Resource crawl is done; now parse the card copy into услуги /
          // акции / обновления and leave «О нас» as narrative.
          if (id && isFinalizableKind(kind)) {
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
              );
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
              push({
                type: "step",
                step: "cleanup",
                status: "error",
                detail: err instanceof Error ? err.message : "Ошибка разбора",
              });
            }
          }

          if (finishedResult && id) {
            try {
              await writePublishedEnrichHistory({
                kind: kind as PublishedEnrichKind,
                entityId: id,
                adminId: user.id,
                result: finishedResult,
              });
            } catch (err) {
              console.error("enrich history write failed", err);
            }
          }

          if (kind === "business") {
            if (slug) revalidatePath(`/business/${slug}`);
            revalidatePath("/search");
          } else if (kind === "professional") {
            if (slug) revalidatePath(`/professional/${slug}`);
            revalidatePath("/professionals");
          } else if (kind === "event") {
            if (slug) revalidatePath(`/events/${slug}`);
            revalidatePath("/events");
          } else if (kind === "job") {
            if (slug) revalidatePath(`/jobs/${slug}`);
          } else if (kind === "transfer") {
            revalidatePath(`/transfers/${id}`);
          } else if (kind === "service") {
            revalidatePath(`/services/${id}`);
          } else if (kind === "marketplace") {
            revalidatePath(`/marketplace/${id}`);
          } else if (kind === "lechu") {
            revalidatePath(`/lechu/${id}`);
          }
          controller.close();
        })();
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
