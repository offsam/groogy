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
  addressKey,
  buildBizProSelfSignals,
  buildOtherSelfSignals,
  catalogSelectFor,
  compareBizProCandidate,
  compareOtherCandidate,
  mergeHitMaps,
} from "@/lib/admin/catalog-duplicate-compare";
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
  kind?: LiveEntityKind;
  id?: string;
};

function isBizPro(
  kind: LiveEntityKind,
): kind is "business" | "professional" {
  return kind === "business" || kind === "professional";
}

async function countApproved(
  catalog: SupabaseClient,
  table: string,
  extra?: Record<string, string>,
): Promise<number> {
  let q = anyFrom(catalog, table)
    .select("id", { count: "exact", head: true })
    .eq("status", table === "listings" ? "active" : table === "events" || table === "jobs" ? "published" : "approved");
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      q = q.eq(k, v);
    }
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
    for (const [k, v] of Object.entries(extra)) {
      q = q.eq(k, v);
    }
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<Record<string, unknown>>;
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
  const id = (body.id || "").trim();
  if (!kind || !id) {
    return NextResponse.json(
      { message: "Нужны kind и id" },
      { status: 400 },
    );
  }

  let catalog: SupabaseClient;
  try {
    catalog = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        message:
          err instanceof Error ? err.message : "Нет service role",
      },
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
        if (isBizPro(kind)) {
          const table = kind === "business" ? "businesses" : "professionals";
          const { data: selfRaw, error: selfErr } = await anyFrom(catalog, table)
            .select(catalogSelectFor(kind))
            .eq("id", id)
            .maybeSingle();
          if (selfErr || !selfRaw) {
            push({
              type: "error",
              message: selfErr?.message || "Карточка не найдена",
            });
            controller.close();
            return;
          }
          const self = selfRaw as Record<string, unknown>;
          const extraAddr = new Set<string>();
          if (kind === "business") {
            const { data: locs } = await anyFrom(catalog, "business_locations")
              .select("address_line, postal_code")
              .eq("business_id", id)
              .eq("status", "published")
              .limit(20);
            for (const loc of (locs ?? []) as Array<{
              address_line: string | null;
              postal_code: string | null;
            }>) {
              const key = addressKey(
                [loc.address_line, loc.postal_code].filter(Boolean).join(", "),
              );
              if (key) extraAddr.add(key);
            }
          }
          const signals = buildBizProSelfSignals(self, kind, extraAddr);
          const bizTotal = await countApproved(catalog, "businesses");
          const proTotal = await countApproved(catalog, "professionals");
          const total = bizTotal + proTotal;
          push({
            type: "started",
            total,
            selfName: signals.selfName,
            label: `Скан двойников «${signals.selfName}»`,
          });

          const hitMap = new Map<string, LiveDuplicateHit>();
          let done = 0;

          const scanTable = async (
            entityType: "business" | "professional",
            tableName: string,
            count: number,
          ) => {
            for (let offset = 0; offset < count; offset += PAGE) {
              const rows = await fetchPage(
                catalog,
                tableName,
                catalogSelectFor(entityType),
                "approved",
                offset,
              );
              for (const row of rows) {
                const hit = compareBizProCandidate(signals, row, entityType);
                if (hit) mergeHitMaps(hitMap, hit);
              }
              done = Math.min(total, done + rows.length);
              const percent =
                total > 0
                  ? Math.round((done / total) * 1000) / 10
                  : 100;
              push({
                type: "progress",
                done,
                total,
                percent,
                hitsSoFar: hitMap.size,
              });
            }
          };

          await scanTable("business", "businesses", bizTotal);
          await scanTable("professional", "professionals", proTotal);

          const dismissed = await loadCatalogDismissPairKeys(catalog);
          const hits = [...hitMap.values()]
            .filter(
              (h) =>
                !h.entityType ||
                !isCatalogPairDismissed(
                  dismissed,
                  { kind, id },
                  { kind: h.entityType, id: h.id },
                ),
            )
            .sort((a, b) => {
            if (a.strength !== b.strength) {
              return a.strength === "exact" ? -1 : 1;
            }
            return (b.fillScore ?? 0) - (a.fillScore ?? 0);
          });

          push({
            type: "finished",
            selfName: signals.selfName,
            hits,
            message: hits.length
              ? `Найдено совпадений: ${hits.length}`
              : "Двойников не найдено",
            done: total,
            total,
            percent: 100,
          });
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

          const selfQ = anyFrom(catalog, table).select(select).eq("id", id);
          const { data: selfRaw, error: selfErr } = await selfQ.maybeSingle();
          if (selfErr || !selfRaw) {
            push({
              type: "error",
              message: selfErr?.message || "Карточка не найдена",
            });
            controller.close();
            return;
          }
          const self = selfRaw as Record<string, unknown>;
          if (
            listingType &&
            self.listing_type &&
            self.listing_type !== listingType
          ) {
            push({
              type: "error",
              message: `Ожидался listing_type=${listingType}`,
            });
            controller.close();
            return;
          }

          const signals = buildOtherSelfSignals(self, kind);
          const extra = listingType ? { listing_type: listingType } : undefined;
          const total = await countApproved(catalog, table, extra);
          push({
            type: "started",
            total,
            selfName: signals.selfName,
            label: `Скан двойников «${signals.selfName}»`,
          });

          const hitMap = new Map<string, LiveDuplicateHit>();
          let done = 0;
          for (let offset = 0; offset < total; offset += PAGE) {
            const rows = await fetchPage(
              catalog,
              table,
              select,
              statusEq,
              offset,
              extra,
            );
            for (const row of rows) {
              if (
                listingType &&
                row.listing_type &&
                row.listing_type !== listingType
              ) {
                continue;
              }
              const hit = compareOtherCandidate(signals, row);
              if (hit) mergeHitMaps(hitMap, hit);
            }
            done = Math.min(total, done + rows.length);
            push({
              type: "progress",
              done,
              total,
              percent:
                total > 0 ? Math.round((done / total) * 1000) / 10 : 100,
              hitsSoFar: hitMap.size,
            });
          }

          const dismissed = await loadCatalogDismissPairKeys(catalog);
          const hits = [...hitMap.values()].filter(
            (h) =>
              !h.entityType ||
              !isCatalogPairDismissed(
                dismissed,
                { kind, id },
                { kind: h.entityType, id: h.id },
              ),
          );
          push({
            type: "finished",
            selfName: signals.selfName,
            hits,
            message: hits.length
              ? `Найдено совпадений: ${hits.length}`
              : "Двойников не найдено",
            done: total,
            total,
            percent: 100,
          });
        }
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
    },
  });
}
