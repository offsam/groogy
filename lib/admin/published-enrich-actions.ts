"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { userIsAdmin } from "@/lib/reviews/queries";
import type {
  EnrichHistoryRow,
  EnrichRunResult,
} from "@/lib/import-review/enrich-progress";
import type { PublishedEnrichKind } from "@/lib/admin/published-enrich-run";

const KINDS = new Set<PublishedEnrichKind>([
  "business",
  "professional",
  "event",
  "service",
  "job",
  "transfer",
  "marketplace",
  "lechu",
  "church",
]);

const TABLE_BY_KIND: Record<PublishedEnrichKind, string> = {
  business: "businesses",
  professional: "professionals",
  event: "events",
  job: "jobs",
  service: "listings",
  transfer: "listings",
  marketplace: "listings",
  lechu: "listings",
  church: "churches",
};

const LOCKED_KEYS = new Set([
  "id",
  "slug",
  "created_at",
  "updated_at",
  "owner_user_id",
  "publisher_id",
  "status",
]);

function untyped(client: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client as unknown as SupabaseClient<any>;
}

function jsonEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export async function listPublishedEnrichHistoryAction(
  kind: PublishedEnrichKind,
  entityId: string,
): Promise<
  { ok: true; rows: EnrichHistoryRow[] } | { ok: false; message: string }
> {
  if (!KINDS.has(kind)) return { ok: false, message: "Некорректный kind" };
  if (!entityId.trim()) return { ok: false, message: "Нужен entityId" };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Нужна авторизация" };
  if (!(await userIsAdmin(supabase)))
    return { ok: false, message: "Только для админов" };

  const { data, error } = await supabase
    .from("entity_enrich_runs")
    .select("id, created_at, note, payload")
    .eq("entity_kind", kind)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) return { ok: false, message: error.message };
  return {
    ok: true,
    rows: (data ?? []).map((row) => {
      const payload = (row.payload ?? {}) as EnrichRunResult &
        Record<string, unknown>;
      return {
        id: row.id as string,
        created_at: row.created_at as string,
        note: (row.note as string | null) ?? null,
        previous_status: null,
        new_status: null,
        changed_fields: payload,
      };
    }),
  };
}

/**
 * Revert the latest (non-reverted) enrich run for a published card.
 * Restores `before` values when present; otherwise clears fields that still
 * match the run's patch (fill-empty safe).
 */
export async function undoLastPublishedEnrichAction(
  kind: PublishedEnrichKind,
  entityId: string,
): Promise<
  | { ok: true; revertedKeys: string[]; message: string }
  | { ok: false; message: string }
> {
  if (!KINDS.has(kind)) return { ok: false, message: "Некорректный kind" };
  if (!entityId.trim()) return { ok: false, message: "Нужен entityId" };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Нужна авторизация" };
  if (!(await userIsAdmin(supabase)))
    return { ok: false, message: "Только для админов" };

  const { data: runs, error: listError } = await supabase
    .from("entity_enrich_runs")
    .select("id, created_at, note, payload")
    .eq("entity_kind", kind)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (listError) return { ok: false, message: listError.message };

  const target = (runs ?? []).find((row) => {
    const payload = (row.payload ?? {}) as EnrichRunResult;
    return !payload.reverted_at;
  });
  if (!target) {
    return { ok: false, message: "Нет обогащения, которое можно отменить" };
  }

  const payload = (target.payload ?? {}) as EnrichRunResult;
  const patch = (payload.patch ?? {}) as Record<string, unknown>;
  const before = (payload.before ?? {}) as Record<string, unknown>;
  const table = TABLE_BY_KIND[kind];
  const catalog = untyped(createServiceRoleClient());

  const { data: current, error: loadError } = await catalog
    .from(table)
    .select("*")
    .eq("id", entityId)
    .maybeSingle();
  if (loadError) return { ok: false, message: loadError.message };
  if (!current) return { ok: false, message: "Карточка не найдена" };

  const row = current as Record<string, unknown>;
  const revert: Record<string, unknown> = {};
  for (const [key, written] of Object.entries(patch)) {
    if (LOCKED_KEYS.has(key)) continue;
    if (!(key in row)) continue;
    // Only touch fields that still look like what this enrich wrote.
    if (!jsonEq(row[key], written)) continue;
    revert[key] = Object.prototype.hasOwnProperty.call(before, key)
      ? before[key]
      : null;
  }

  if (Object.keys(revert).length) {
    const { error: updateError } = await catalog
      .from(table)
      .update(revert)
      .eq("id", entityId);
    if (updateError) return { ok: false, message: updateError.message };
  }

  const revertedAt = new Date().toISOString();
  const nextPayload: EnrichRunResult = {
    ...payload,
    reverted_at: revertedAt,
  };
  const baseNote = (target.note as string | null)?.trim() || "Обогащение";
  const nextNote = /отменено/i.test(baseNote)
    ? baseNote
    : `${baseNote} · отменено`;

  const { error: markError } = await supabase
    .from("entity_enrich_runs")
    .update({
      payload: nextPayload as unknown as import("@/types/database").Json,
      note: nextNote,
    })
    .eq("id", target.id);
  if (markError) return { ok: false, message: markError.message };

  const slug = typeof row.slug === "string" ? row.slug : "";
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
    revalidatePath(`/transfers/${entityId}`);
  } else if (kind === "service") {
    revalidatePath(`/services/${entityId}`);
  } else if (kind === "marketplace") {
    revalidatePath(`/marketplace/${entityId}`);
  } else if (kind === "lechu") {
    revalidatePath(`/lechu/${entityId}`);
  }

  const keys = Object.keys(revert);
  return {
    ok: true,
    revertedKeys: keys,
    message: keys.length
      ? `Отменено: ${keys.join(", ")}`
      : "Запуск отмечен как отменённый (полей для отката не осталось)",
  };
}
