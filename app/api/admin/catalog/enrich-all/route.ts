import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { userIsAdmin } from "@/lib/reviews/queries";
import {
  spawnPublishedEnrich,
  type PublishedEnrichKind,
} from "@/lib/admin/published-enrich-run";
import {
  finalizePublishedEnrich,
  isFinalizableKind,
} from "@/lib/admin/published-finalize-enrich";
import type { EnrichRunResult } from "@/lib/import-review/enrich-progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Long batch — local admin / generous hosts. */
export const maxDuration = 800;

function anyFrom(client: SupabaseClient, table: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client as any).from(table);
}

type Target = { id: string; slug: string | null; name: string };

type Body = {
  kind?: PublishedEnrichKind;
  /** Max cards this request (resume with offset). Default 50. */
  limit?: number;
  offset?: number;
  /** Entity id for mode=mark after a successful enrich-all card. */
  id?: string;
  /**
   * list — targets that still need enrich (skip already enriched).
   * run — server-side batch (legacy).
   * mark — record that enrich-all touched this card (skip next time).
   */
  mode?: "list" | "run" | "mark";
};

function listingTypeFor(
  kind: PublishedEnrichKind,
): string | null {
  if (kind === "marketplace") return "marketplace_item";
  if (kind === "lechu") return "transport_carry";
  if (kind === "transfer") return "transfer";
  if (kind === "service") return "service";
  return null;
}

/** Cards already enriched (history) — enrich-all must not touch them again. */
async function loadAlreadyEnrichedIds(
  catalog: SupabaseClient,
  kind: PublishedEnrichKind,
): Promise<Set<string>> {
  const ids = new Set<string>();
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await anyFrom(catalog, "entity_enrich_runs")
      .select("entity_id")
      .eq("entity_kind", kind)
      .order("entity_id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ entity_id: string }>;
    if (rows.length === 0) break;
    for (const row of rows) {
      if (row.entity_id) ids.add(row.entity_id);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  // Local to4ka mass-enrich checkpoint (Python) may not write entity_enrich_runs.
  if (kind === "business") {
    try {
      const { promises: fs } = await import("node:fs");
      const path = await import("node:path");
      const checkpointPath = path.join(
        process.cwd(),
        "scripts/business-enrich/data/to4ka_enrich/checkpoint.json",
      );
      const raw = await fs.readFile(checkpointPath, "utf8");
      const parsed = JSON.parse(raw) as { done_ids?: string[] };
      for (const id of parsed.done_ids ?? []) {
        if (id) ids.add(id);
      }
    } catch {
      /* no checkpoint */
    }
  }

  return ids;
}

async function fetchRawPage(
  catalog: SupabaseClient,
  kind: PublishedEnrichKind,
  offset: number,
  limit: number,
): Promise<{ total: number; items: Target[] }> {
  if (kind === "business") {
    const { count } = await anyFrom(catalog, "businesses")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved");
    const { data, error } = await anyFrom(catalog, "businesses")
      .select("id, slug, name")
      .eq("status", "approved")
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return {
      total: count ?? 0,
      items: ((data ?? []) as Target[]).map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name || "—",
      })),
    };
  }
  if (kind === "professional") {
    const { count } = await anyFrom(catalog, "professionals")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved");
    const { data, error } = await anyFrom(catalog, "professionals")
      .select("id, slug, display_name")
      .eq("status", "approved")
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return {
      total: count ?? 0,
      items: (
        (data ?? []) as Array<{
          id: string;
          slug: string | null;
          display_name: string | null;
        }>
      ).map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.display_name || "—",
      })),
    };
  }
  if (kind === "church") {
    const { count } = await anyFrom(catalog, "churches")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved");
    const { data, error } = await anyFrom(catalog, "churches")
      .select("id, slug, name")
      .eq("status", "approved")
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return {
      total: count ?? 0,
      items: ((data ?? []) as Target[]).map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name || "—",
      })),
    };
  }
  if (kind === "event" || kind === "job") {
    const table = kind === "event" ? "events" : "jobs";
    const { count } = await anyFrom(catalog, table)
      .select("id", { count: "exact", head: true })
      .eq("status", "published");
    const { data, error } = await anyFrom(catalog, table)
      .select("id, slug, title")
      .eq("status", "published")
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return {
      total: count ?? 0,
      items: (
        (data ?? []) as Array<{
          id: string;
          slug: string | null;
          title: string | null;
        }>
      ).map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.title || "—",
      })),
    };
  }

  const listingType = listingTypeFor(kind);
  let countQ = anyFrom(catalog, "listings")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");
  if (listingType) countQ = countQ.eq("listing_type", listingType);
  const { count } = await countQ;
  let dataQ = anyFrom(catalog, "listings")
    .select("id, title")
    .eq("status", "active")
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);
  if (listingType) dataQ = dataQ.eq("listing_type", listingType);
  const { data, error } = await dataQ;
  if (error) throw new Error(error.message);
  return {
    total: count ?? 0,
    items: (
      (data ?? []) as Array<{ id: string; title: string | null }>
    ).map((r) => ({
      id: r.id,
      slug: null,
      name: r.title || "—",
    })),
  };
}

/**
 * Only cards that have never been enriched (no entity_enrich_runs /
 * to4ka checkpoint). Offset/limit apply to that filtered list.
 */
async function listTargets(
  catalog: SupabaseClient,
  kind: PublishedEnrichKind,
  offset: number,
  limit: number,
): Promise<{ total: number; items: Target[]; skippedAlready: number }> {
  const already = await loadAlreadyEnrichedIds(catalog, kind);
  const pageSize = 100;
  const items: Target[] = [];
  let rawOffset = 0;
  let catalogTotal = 0;
  let keptBeforeOffset = 0;
  let unenrichedSeen = 0;

  for (;;) {
    const page = await fetchRawPage(catalog, kind, rawOffset, pageSize);
    catalogTotal = page.total;
    if (page.items.length === 0) break;

    for (const row of page.items) {
      if (already.has(row.id)) continue;
      unenrichedSeen += 1;
      if (keptBeforeOffset < offset) {
        keptBeforeOffset += 1;
        continue;
      }
      if (items.length < limit) {
        items.push(row);
      }
    }

    rawOffset += page.items.length;
    if (rawOffset >= catalogTotal) break;
    // Early exit once we have a full page and know there is at least one more
    // unenriched after it — still need accurate total, so keep scanning ids only.
    if (items.length >= limit && rawOffset < catalogTotal) {
      // Finish counting remaining unenriched without building more items.
      for (;;) {
        const rest = await fetchRawPage(catalog, kind, rawOffset, pageSize);
        if (rest.items.length === 0) break;
        for (const row of rest.items) {
          if (!already.has(row.id)) unenrichedSeen += 1;
        }
        rawOffset += rest.items.length;
        if (rawOffset >= catalogTotal) break;
      }
      break;
    }
  }

  return {
    total: unenrichedSeen,
    items,
    skippedAlready: Math.max(0, catalogTotal - unenrichedSeen),
  };
}

async function markEnrichAllPass(
  catalog: SupabaseClient,
  kind: PublishedEnrichKind,
  entityId: string,
  adminId: string,
): Promise<void> {
  const { error } = await anyFrom(catalog, "entity_enrich_runs").insert({
    entity_kind: kind,
    entity_id: entityId,
    admin_id: adminId,
    note: "Обогатить всё · прогон",
    payload: { source: "catalog_enrich_all" },
  });
  if (error) {
    // Duplicate / constraint — still ok for skip semantics if a row exists.
    console.error("enrich-all mark failed", error.message);
  }
}

function runOneEnrich(
  kind: PublishedEnrichKind,
  target: Target,
): Promise<{ ok: boolean; message?: string; result?: EnrichRunResult | null }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawnPublishedEnrich>["child"];
    try {
      child = spawnPublishedEnrich({
        kind,
        id: target.id,
        slug: target.slug || undefined,
      }).child;
    } catch (err) {
      resolve({
        ok: false,
        message: err instanceof Error ? err.message : "spawn failed",
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let finished: EnrichRunResult | null = null;
    let lineBuf = "";

    const onLine = (line: string) => {
      const t = line.trim();
      if (!t) return;
      try {
        const ev = JSON.parse(t) as {
          type?: string;
          result?: EnrichRunResult;
          message?: string;
        };
        if (ev.type === "finished") finished = ev.result ?? null;
      } catch {
        /* ignore */
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      lineBuf += text;
      const parts = lineBuf.split("\n");
      lineBuf = parts.pop() ?? "";
      for (const p of parts) onLine(p);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      resolve({ ok: false, message: err.message });
    });
    child.on("close", (code) => {
      void (async () => {
        if (lineBuf.trim()) onLine(lineBuf);
        if (code !== 0) {
          resolve({
            ok: false,
            message:
              (stderr || stdout).trim().slice(0, 400) ||
              `exit ${code ?? "?"}`,
          });
          return;
        }
        try {
          if (isFinalizableKind(kind) && finished) {
            const catalog = createServiceRoleClient();
            await finalizePublishedEnrich(
              catalog,
              kind,
              target.id,
              finished,
            );
          }
        } catch (err) {
          resolve({
            ok: true,
            message:
              err instanceof Error
                ? `Обогащено, finalize: ${err.message}`
                : "Обогащено, finalize error",
            result: finished,
          });
          return;
        }
        resolve({ ok: true, result: finished });
      })();
    });
  });
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
  const allowed: PublishedEnrichKind[] = [
    "business",
    "professional",
    "event",
    "job",
    "service",
    "transfer",
    "marketplace",
    "lechu",
    "church",
  ];
  if (!kind || !allowed.includes(kind)) {
    return NextResponse.json({ message: "Некорректный kind" }, { status: 400 });
  }

  const limit = Math.min(Math.max(Number(body.limit) || 40, 1), 100);
  const offset = Math.max(Number(body.offset) || 0, 0);
  const mode =
    body.mode === "list" || body.mode === "mark" ? body.mode : "run";

  let catalog: SupabaseClient;
  try {
    catalog = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Нет service role" },
      { status: 500 },
    );
  }

  if (mode === "mark") {
    const entityId = String(body.id || "").trim();
    if (!entityId) {
      return NextResponse.json({ message: "Нужен id" }, { status: 400 });
    }
    try {
      await markEnrichAllPass(catalog, kind, entityId, user.id);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json(
        {
          message:
            err instanceof Error ? err.message : "Не удалось отметить прогон",
        },
        { status: 500 },
      );
    }
  }

  if (mode === "list") {
    try {
      const { total, items, skippedAlready } = await listTargets(
        catalog,
        kind,
        offset,
        limit,
      );
      return NextResponse.json({
        total,
        offset,
        limit,
        items,
        skippedAlready,
        hasMore: offset + items.length < total,
        nextOffset: offset + items.length,
      });
    } catch (err) {
      return NextResponse.json(
        {
          message:
            err instanceof Error ? err.message : "Не удалось загрузить список",
        },
        { status: 500 },
      );
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (obj: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          /* */
        }
      };

      // First byte immediately — avoids browser "Failed to fetch" while listing.
      push({
        type: "hello",
        kind,
        offset,
        limit,
        message: "Подключение…",
      });
      await yieldTick();

      try {
        const { total, items } = await listTargets(
          catalog,
          kind,
          offset,
          limit,
        );
        push({
          type: "started",
          total,
          batchSize: items.length,
          offset,
          limit,
          label: `Обогатить все · ${kind}`,
        });
        await yieldTick();

        let applied = 0;
        let failed = 0;
        for (let i = 0; i < items.length; i += 1) {
          const target = items[i];
          const globalDone = offset + i;
          const percent =
            total > 0
              ? Math.round(((globalDone + 1) / total) * 1000) / 10
              : 100;
          push({
            type: "progress",
            done: globalDone,
            total,
            percent: Math.min(
              100,
              Math.round((globalDone / Math.max(total, 1)) * 1000) / 10,
            ),
            currentName: target.name,
            currentId: target.id,
          });
          await yieldTick();

          const res = await runOneEnrich(kind, target);
          if (res.ok) {
            applied += 1;
            await markEnrichAllPass(catalog, kind, target.id, user.id);
            push({
              type: "item_done",
              id: target.id,
              name: target.name,
            });
          } else {
            failed += 1;
            push({
              type: "item_error",
              id: target.id,
              name: target.name,
              message: res.message || "Ошибка",
            });
          }
          await yieldTick();

          push({
            type: "progress",
            done: globalDone + 1,
            total,
            percent,
            currentName: target.name,
            currentId: target.id,
            applied,
            failed,
          });
          await yieldTick();
        }

        const nextOffset = offset + items.length;
        push({
          type: "finished",
          total,
          offset,
          nextOffset,
          hasMore: nextOffset < total,
          applied,
          failed,
          batchSize: items.length,
          message:
            nextOffset < total
              ? `Пакет: +${applied} ок, ${failed} ошибок · дальше ${nextOffset}/${total}`
              : `Готово: ${applied} обогащено, ${failed} ошибок из ${total}.`,
          done: nextOffset,
          percent:
            total > 0
              ? Math.round((Math.min(nextOffset, total) / total) * 1000) / 10
              : 100,
        });
      } catch (err) {
        push({
          type: "error",
          message: err instanceof Error ? err.message : "Ошибка enrich-all",
        });
      } finally {
        try {
          controller.close();
        } catch {
          /* */
        }
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

function yieldTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
