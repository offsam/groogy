import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { userIsAdmin } from "@/lib/reviews/queries";
import type {
  LiveDuplicateHit,
  LiveEntityKind,
} from "@/lib/admin/published-duplicates-scan";
import {
  buildBizProSelfSignals,
  buildOtherSelfSignals,
  catalogSelectFor,
  compareBizProCandidate,
  compareOtherCandidate,
  mergeHitMaps,
  publicHrefFor,
  BIZ_PRO_MATCH_SLOTS,
  OTHER_MATCH_SLOTS,
  type OtherSelfSignals,
  type SelfScanSignals,
} from "@/lib/admin/catalog-duplicate-compare";
import type { PublishedEnrichKind } from "@/lib/admin/published-enrich-run";
import {
  isCatalogPairDismissed,
  loadCatalogDismissPairKeys,
} from "@/lib/admin/catalog-duplicate-dismissals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PAGE = 150;

function anyFrom(client: SupabaseClient, table: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client as any).from(table);
}

type Body = {
  kind?: PublishedEnrichKind | LiveEntityKind;
};

type Pair = {
  a: {
    id: string;
    kind: string;
    name: string;
    href: string | null;
    slug?: string | null;
  };
  b: {
    id: string;
    kind: string;
    name: string;
    href: string | null;
    slug?: string | null;
  };
  strength: "exact" | "weak";
  reason: string;
  suggestedKeepId: string;
  suggestedDropId: string;
  matchCount: number;
  matchParams: string[];
  matchPercent: number;
};

async function countApproved(
  catalog: SupabaseClient,
  table: string,
  statusEq: string,
  extra?: Record<string, string>,
): Promise<number> {
  let q = anyFrom(catalog, table)
    .select("id", { count: "exact", head: true })
    .eq("status", statusEq);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) q = q.eq(k, v);
  }
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function fetchPage(
  catalog: SupabaseClient,
  table: string,
  select: string,
  statusEq: string,
  offset: number,
  extra?: Record<string, string>,
): Promise<Array<Record<string, unknown>>> {
  let q = anyFrom(catalog, table)
    .select(select)
    .eq("status", statusEq)
    .order("id", { ascending: true })
    .range(offset, offset + PAGE - 1);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) q = q.eq(k, v);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<Record<string, unknown>>;
}

function pairKey(aId: string, bId: string): string {
  return aId < bId ? `${aId}:${bId}` : `${bId}:${aId}`;
}

function indexAdd(
  index: Map<string, Set<number>>,
  key: string | null | undefined,
  idx: number,
) {
  if (!key) return;
  let set = index.get(key);
  if (!set) {
    set = new Set();
    index.set(key, set);
  }
  set.add(idx);
}

function collectFromIndex(
  index: Map<string, Set<number>>,
  key: string | null | undefined,
  out: Set<number>,
  /** Skip keys shared by too many cards (ads / polluted contacts). */
  maxShared = 8,
) {
  if (!key) return;
  const set = index.get(key);
  if (!set || set.size < 2) return;
  if (set.size > maxShared) return;
  for (const i of set) out.add(i);
}

/** Let the NDJSON chunk leave the process (avoid long sync stalls). */
function yieldTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
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
  if (!kind || kind === "church") {
    return NextResponse.json(
      { message: "Для этого раздела скан двойников пока недоступен" },
      { status: 400 },
    );
  }

  let catalog: SupabaseClient;
  try {
    catalog = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Нет service role" },
      { status: 500 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (obj: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          /* closed */
        }
      };

        try {
        const dismissed = await loadCatalogDismissPairKeys(catalog);
        const pairs = new Map<string, Pair>();

        const addPair = (
          selfId: string,
          selfKind: string,
          selfName: string,
          selfSlug: string | null,
          hit: LiveDuplicateHit,
          slots: number,
        ) => {
          if (!hit.entityType) return;
          if (
            isCatalogPairDismissed(
              dismissed,
              { kind: selfKind, id: selfId },
              { kind: hit.entityType, id: hit.id },
            )
          ) {
            return;
          }
          const key = pairKey(selfId, hit.id);
          const matchCount = hit.matchCount ?? 1;
          const matchParams = hit.matchParams ?? [];
          const matchPercent =
            slots > 0 ? Math.round((matchCount / slots) * 1000) / 10 : 0;
          const prev = pairs.get(key);
          if (prev && prev.matchCount > matchCount) return;
          if (
            prev &&
            prev.matchCount === matchCount &&
            prev.strength === "exact" &&
            hit.strength === "weak"
          ) {
            return;
          }
          const keepId = hit.suggestedKeepId || selfId;
          const dropId = hit.suggestedDropId || hit.id;
          pairs.set(key, {
            a: {
              id: selfId,
              kind: selfKind,
              name: selfName,
              slug: selfSlug,
              href: publicHrefFor(
                selfKind as LiveEntityKind,
                selfId,
                selfSlug,
              ),
            },
            b: {
              id: hit.id,
              kind: hit.entityType,
              name: hit.name,
              slug: hit.slug,
              href: hit.href ?? null,
            },
            strength: hit.strength,
            reason: hit.reason,
            suggestedKeepId: keepId,
            suggestedDropId: dropId,
            matchCount,
            matchParams,
            matchPercent,
          });
        };

        if (kind === "business" || kind === "professional") {
          const bizTotal = await countApproved(catalog, "businesses", "approved");
          const proTotal = await countApproved(
            catalog,
            "professionals",
            "approved",
          );
          const loadTotal = bizTotal + proTotal;
          const primaryKind = kind;
          const scanTotal = kind === "business" ? bizTotal : proTotal;

          push({
            type: "started",
            phase: "load",
            total: loadTotal,
            scanTotal,
            label: "Загрузка каталога…",
          });
          await yieldTick();

          type Entry = {
            kind: "business" | "professional";
            row: Record<string, unknown>;
            signals: SelfScanSignals;
          };
          const universe: Entry[] = [];

          let loaded = 0;
          const loadTable = async (
            entityType: "business" | "professional",
            tableName: string,
            count: number,
          ) => {
            for (let offset = 0; offset < count; offset += PAGE) {
              if (request.signal.aborted) return;
              const rows = await fetchPage(
                catalog,
                tableName,
                catalogSelectFor(entityType),
                "approved",
                offset,
              );
              for (const row of rows) {
                universe.push({
                  kind: entityType,
                  row,
                  signals: buildBizProSelfSignals(row, entityType),
                });
              }
              loaded = Math.min(loadTotal, loaded + rows.length);
              push({
                type: "progress",
                phase: "load",
                done: loaded,
                total: loadTotal,
                percent:
                  loadTotal > 0
                    ? Math.round((loaded / loadTotal) * 1000) / 10
                    : 100,
                currentName: "Загрузка каталога…",
              });
              await yieldTick();
            }
          };

          await loadTable("business", "businesses", bizTotal);
          await loadTable("professional", "professionals", proTotal);
          if (request.signal.aborted) {
            push({ type: "error", message: "Отменено" });
            return;
          }

          const byPhone = new Map<string, Set<number>>();
          const byEmail = new Map<string, Set<number>>();
          const byIg = new Map<string, Set<number>>();
          const byTg = new Map<string, Set<number>>();
          const byHost = new Map<string, Set<number>>();
          const bySource = new Map<string, Set<number>>();
          const byAddr = new Map<string, Set<number>>();
          const byName = new Map<string, Set<number>>();

          for (let i = 0; i < universe.length; i += 1) {
            const s = universe[i].signals;
            if (s.phone.length >= 10) indexAdd(byPhone, s.phone, i);
            indexAdd(byEmail, s.email, i);
            indexAdd(byIg, s.ig, i);
            indexAdd(byTg, s.tg, i);
            indexAdd(byHost, s.host, i);
            if (s.source) indexAdd(bySource, s.source, i);
            for (const a of s.addressKeys) indexAdd(byAddr, a, i);
            for (const n of s.nameKeys) {
              if (n.length >= 4) indexAdd(byName, n, i);
            }
          }

          push({
            type: "progress",
            phase: "scan",
            done: 0,
            total: scanTotal,
            percent: 0,
            currentName: "Сравнение…",
          });
          await yieldTick();

          let scanned = 0;
          for (let i = 0; i < universe.length; i += 1) {
            if (request.signal.aborted) break;
            const entry = universe[i];
            if (entry.kind !== primaryKind) continue;

            const s = entry.signals;
            const candIdx = new Set<number>();
            if (s.phone.length >= 10) collectFromIndex(byPhone, s.phone, candIdx, 8);
            collectFromIndex(byEmail, s.email, candIdx, 6);
            collectFromIndex(byIg, s.ig, candIdx, 8);
            collectFromIndex(byTg, s.tg, candIdx, 8);
            collectFromIndex(byHost, s.host, candIdx, 8);
            if (s.source) collectFromIndex(bySource, s.source, candIdx, 6);
            for (const a of s.addressKeys) collectFromIndex(byAddr, a, candIdx, 8);
            for (const n of s.nameKeys) {
              if (n.length >= 4) collectFromIndex(byName, n, candIdx, 20);
            }

            const hitMap = new Map<string, LiveDuplicateHit>();
            for (const j of candIdx) {
              if (j === i) continue;
              const other = universe[j];
              const otherId = String(other.row.id);
              if (otherId < s.selfId) continue;
              const hit = compareBizProCandidate(s, other.row, other.kind);
              if (hit) mergeHitMaps(hitMap, hit);
            }
            for (const hit of hitMap.values()) {
              addPair(
                s.selfId,
                primaryKind,
                s.selfName,
                (entry.row.slug as string) || null,
                hit,
                BIZ_PRO_MATCH_SLOTS,
              );
            }

            scanned += 1;
            if (scanned % 50 === 0 || scanned === scanTotal) {
              push({
                type: "progress",
                phase: "scan",
                done: scanned,
                total: scanTotal,
                percent:
                  scanTotal > 0
                    ? Math.round((scanned / scanTotal) * 1000) / 10
                    : 100,
                pairsSoFar: pairs.size,
                currentName: s.selfName,
              });
              await yieldTick();
            }
          }
        } else {
          const listingType =
            kind === "marketplace"
              ? "marketplace_item"
              : kind === "lechu"
                ? "transport_carry"
                : kind === "transfer"
                  ? "transfer"
                  : kind === "service"
                    ? "service"
                    : null;
          const table =
            kind === "event" ? "events" : kind === "job" ? "jobs" : "listings";
          const statusEq =
            kind === "event" || kind === "job" ? "published" : "active";
          const select =
            kind === "event"
              ? "id, slug, title, phone, registration_url, source_url, description, city, cover_image_url, status"
              : kind === "job"
                ? "id, slug, title, source_url, description, city, status"
                : "id, title, source_url, description, city, status, listing_type";
          const extra = listingType ? { listing_type: listingType } : undefined;
          const total = await countApproved(catalog, table, statusEq, extra);

          push({
            type: "started",
            phase: "load",
            total,
            scanTotal: total,
            label: `Поиск двойников по разделу «${kind}»`,
          });
          await yieldTick();

          const liveKind = kind as Exclude<
            LiveEntityKind,
            "business" | "professional"
          >;
          type OtherEntry = {
            row: Record<string, unknown>;
            signals: OtherSelfSignals;
          };
          const rows: OtherEntry[] = [];
          let loaded = 0;
          for (let offset = 0; offset < total; offset += PAGE) {
            if (request.signal.aborted) break;
            const page = await fetchPage(
              catalog,
              table,
              select,
              statusEq,
              offset,
              extra,
            );
            for (const row of page) {
              rows.push({
                row,
                signals: buildOtherSelfSignals(row, liveKind),
              });
            }
            loaded = Math.min(total, loaded + page.length);
            push({
              type: "progress",
              phase: "load",
              done: loaded,
              total,
              percent:
                total > 0 ? Math.round((loaded / total) * 1000) / 10 : 100,
              currentName: "Загрузка…",
            });
            await yieldTick();
          }

          const byPhone = new Map<string, Set<number>>();
          const bySource = new Map<string, Set<number>>();
          const byName = new Map<string, Set<number>>();
          for (let i = 0; i < rows.length; i += 1) {
            const s = rows[i].signals;
            if (s.phone.length >= 10) indexAdd(byPhone, s.phone, i);
            if (s.source) indexAdd(bySource, s.source, i);
            if (s.nameKey.length >= 6) indexAdd(byName, s.nameKey, i);
          }

          for (let i = 0; i < rows.length; i += 1) {
            if (request.signal.aborted) break;
            const entry = rows[i];
            const s = entry.signals;
            const candIdx = new Set<number>();
            if (s.phone.length >= 10) collectFromIndex(byPhone, s.phone, candIdx, 8);
            if (s.source) collectFromIndex(bySource, s.source, candIdx, 6);
            if (s.nameKey.length >= 6) collectFromIndex(byName, s.nameKey, candIdx, 20);

            const hitMap = new Map<string, LiveDuplicateHit>();
            for (const j of candIdx) {
              if (j === i) continue;
              const other = rows[j];
              if (String(other.row.id) < s.selfId) continue;
              const hit = compareOtherCandidate(s, other.row);
              if (hit) mergeHitMaps(hitMap, hit);
            }
            for (const hit of hitMap.values()) {
              addPair(
                s.selfId,
                liveKind,
                s.selfName,
                (entry.row.slug as string) || null,
                hit,
                OTHER_MATCH_SLOTS,
              );
            }

            const done = i + 1;
            if (done % 50 === 0 || done === rows.length) {
              push({
                type: "progress",
                phase: "scan",
                done,
                total: rows.length,
                percent:
                  rows.length > 0
                    ? Math.round((done / rows.length) * 1000) / 10
                    : 100,
                pairsSoFar: pairs.size,
                currentName: s.selfName,
              });
              await yieldTick();
            }
          }
        }

        if (request.signal.aborted) {
          push({ type: "error", message: "Отменено" });
          return;
        }

        const list = [...pairs.values()].sort((a, b) => {
          if (b.matchPercent !== a.matchPercent) {
            return b.matchPercent - a.matchPercent;
          }
          if (b.matchCount !== a.matchCount) {
            return b.matchCount - a.matchCount;
          }
          if (a.strength !== b.strength) {
            return a.strength === "exact" ? -1 : 1;
          }
          return a.a.name.localeCompare(b.a.name, "ru");
        });

        const cardIds = new Set<string>();
        for (const p of list) {
          cardIds.add(p.a.id);
          cardIds.add(p.b.id);
        }

        push({
          type: "finished",
          percent: 100,
          pairs: list,
          cardsWithMatches: cardIds.size,
          pairCount: list.length,
          message: list.length
            ? `Пар: ${list.length} · карточек: ${cardIds.size}. Сверху — больше общих полей (выше вероятность дубля).`
            : "Двойников в разделе не найдено",
        });
      } catch (err) {
        push({
          type: "error",
          message: err instanceof Error ? err.message : "Ошибка скана",
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
