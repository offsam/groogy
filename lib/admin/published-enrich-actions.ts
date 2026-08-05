"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { userIsAdmin } from "@/lib/reviews/queries";
import type {
  EnrichConflictAction,
  EnrichHistoryRow,
  EnrichRunResult,
} from "@/lib/import-review/enrich-progress";
import { enrichConflictCanAdd } from "@/lib/import-review/enrich-progress";
import type { PublishedEnrichKind } from "@/lib/admin/published-enrich-run";
import {
  parseContactLinks,
  serializeContactLinks,
  type ContactLink,
} from "@/lib/contacts/channels";

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

/**
 * Revert selected fields from a specific enrich history run.
 * Only touches live values that still match what that run wrote.
 */
export async function revertPublishedEnrichFieldsAction(
  kind: PublishedEnrichKind,
  entityId: string,
  runId: string,
  fields: string[],
): Promise<
  | { ok: true; revertedKeys: string[]; message: string }
  | { ok: false; message: string }
> {
  if (!KINDS.has(kind)) return { ok: false, message: "Некорректный kind" };
  if (!entityId.trim() || !runId.trim()) {
    return { ok: false, message: "Нужны entityId и runId" };
  }
  const wanted = [
    ...new Set(fields.map((f) => f.trim()).filter(Boolean)),
  ].filter((k) => !LOCKED_KEYS.has(k));
  if (!wanted.length) return { ok: false, message: "Нечего удалять" };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Нужна авторизация" };
  if (!(await userIsAdmin(supabase)))
    return { ok: false, message: "Только для админов" };

  const { data: run, error: loadRunError } = await supabase
    .from("entity_enrich_runs")
    .select("id, note, payload, entity_id, entity_kind")
    .eq("id", runId)
    .eq("entity_kind", kind)
    .eq("entity_id", entityId)
    .maybeSingle();
  if (loadRunError) return { ok: false, message: loadRunError.message };
  if (!run) return { ok: false, message: "Запись истории не найдена" };

  const payload = (run.payload ?? {}) as EnrichRunResult;
  if (payload.reverted_at) {
    return { ok: false, message: "Это обогащение уже полностью отменено" };
  }
  const patch = (payload.patch ?? {}) as Record<string, unknown>;
  const before = (payload.before ?? {}) as Record<string, unknown>;
  const already = new Set(payload.reverted_fields ?? []);
  const targets = wanted.filter((k) => k in patch && !already.has(k));
  if (!targets.length) {
    return { ok: false, message: "Этих полей нет в этом запуске" };
  }

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
  const revertedKeys: string[] = [];
  for (const key of targets) {
    if (!(key in row)) continue;
    const written = patch[key];
    if (!jsonEq(row[key], written)) continue;
    revert[key] = Object.prototype.hasOwnProperty.call(before, key)
      ? before[key]
      : null;
    revertedKeys.push(key);
  }

  if (Object.keys(revert).length) {
    const { error: updateError } = await catalog
      .from(table)
      .update(revert)
      .eq("id", entityId);
    if (updateError) return { ok: false, message: updateError.message };
  }

  const nextReverted = [...new Set([...already, ...revertedKeys])];
  const remaining = Object.keys(patch).filter((k) => !nextReverted.includes(k));
  const fullyDone = remaining.length === 0;
  const revertedAt = fullyDone ? new Date().toISOString() : payload.reverted_at ?? null;
  const nextPayload: EnrichRunResult = {
    ...payload,
    reverted_fields: nextReverted,
    reverted_at: revertedAt,
  };
  const baseNote = (run.note as string | null)?.trim() || "Обогащение";
  const nextNote =
    fullyDone && !/отменено/i.test(baseNote)
      ? `${baseNote} · отменено`
      : baseNote;

  const { error: markError } = await supabase
    .from("entity_enrich_runs")
    .update({
      payload: nextPayload as unknown as import("@/types/database").Json,
      note: nextNote,
    })
    .eq("id", runId);
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

  return {
    ok: true,
    revertedKeys,
    message: revertedKeys.length
      ? `Удалено из карточки: ${revertedKeys.join(", ")}`
      : "Поля уже изменены вручную — с карточки ничего не снято",
  };
}

const CONFLICT_KEYS = new Set([
  "phone",
  "email",
  "website",
  "instagram_url",
  "telegram_url",
  "address_line",
  "description",
]);

function phoneDigitsKey(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

function emailKey(value: string): string {
  return value.trim().toLowerCase();
}

function urlKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

function linkAlreadyPresent(
  links: ContactLink[],
  opts: {
    phone?: string;
    email?: string;
    url?: string;
  },
): boolean {
  for (const link of links) {
    const v = link.value.trim();
    if (!v) continue;
    if (opts.phone && phoneDigitsKey(v) === phoneDigitsKey(opts.phone)) {
      return true;
    }
    if (opts.email && emailKey(v) === emailKey(opts.email)) return true;
    if (opts.url && urlKey(v) === urlKey(opts.url)) return true;
  }
  return false;
}

function appendContactLink(
  existing: unknown,
  link: ContactLink,
): ContactLink[] {
  const links = parseContactLinks(existing);
  if (link.channel === "custom" && link.label === "Телефон") {
    if (linkAlreadyPresent(links, { phone: link.value })) return links;
  } else if (link.channel === "custom" && link.label === "Email") {
    if (linkAlreadyPresent(links, { email: link.value })) return links;
  } else if (linkAlreadyPresent(links, { url: link.value })) {
    return links;
  }
  return serializeContactLinks([...links, link]);
}

/**
 * Apply admin-confirmed enrich conflicts (found ≠ card, skipped by fill-empty).
 * mode replace → dedicated columns; mode add → contact_links / business_locations.
 */
export async function applyEnrichFieldConflictsAction(input: {
  kind: PublishedEnrichKind;
  entityId: string;
  /** @deprecated prefer `actions` */
  keys?: string[];
  actions?: EnrichConflictAction[];
  conflicts: NonNullable<EnrichRunResult["field_conflicts"]>;
  queue?: { source: "import_review" | "recommendation"; id: string };
}): Promise<
  | {
      ok: true;
      applied: string[];
      replaced: string[];
      added: string[];
      message: string;
    }
  | { ok: false; message: string }
> {
  const { kind, entityId, conflicts, queue } = input;
  if (!KINDS.has(kind)) return { ok: false, message: "Некорректный kind" };
  if (!entityId.trim() && !queue?.id) {
    return { ok: false, message: "Нужен entityId" };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Нужна авторизация" };
  if (!(await userIsAdmin(supabase)))
    return { ok: false, message: "Только для админов" };

  const rawActions: EnrichConflictAction[] =
    input.actions?.length
      ? input.actions
      : (input.keys ?? []).map((key) => ({
          key,
          mode: "replace" as const,
        }));

  const actions = rawActions.filter(
    (a) =>
      CONFLICT_KEYS.has(a.key) &&
      (a.mode === "replace" || a.mode === "add") &&
      (a.mode !== "add" || enrichConflictCanAdd(a.key, kind)),
  );
  // Queue address add not supported (replace only).
  const resolved = actions.filter((a) => {
    if (a.mode !== "add") return true;
    if (a.key === "address_line" && queue) return false;
    if (a.key === "address_line" && kind !== "business") return false;
    return true;
  });

  if (!resolved.length) {
    return { ok: false, message: "Нечего обновлять" };
  }

  const byKey = new Map(
    (conflicts ?? [])
      .filter((c) => c?.key && c.found)
      .map((c) => [c.key, c] as const),
  );

  const catalog = untyped(createServiceRoleClient());
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  const replaced: string[] = [];
  const added: string[] = [];

  if (queue?.source === "recommendation") {
    for (const { key, mode } of resolved) {
      const c = byKey.get(key);
      if (!c?.found) continue;
      if (mode === "add" && key === "phone") {
        const { data: row } = await catalog
          .from("import_comment_recommendations")
          .select("phones")
          .eq("id", queue.id)
          .maybeSingle();
        const phones = Array.isArray(
          (row as { phones?: unknown } | null)?.phones,
        )
          ? ([...(row as { phones: unknown[] }).phones] as string[])
          : [];
        const foundDigits = phoneDigitsKey(c.found);
        if (
          !phones.some(
            (p) => phoneDigitsKey(String(p)) === foundDigits,
          )
        ) {
          phones.push(c.found);
          patch.phones = phones;
          added.push(key);
        }
        continue;
      }
      if (mode === "add" && key === "website") {
        const { data: row } = await catalog
          .from("import_comment_recommendations")
          .select("websites")
          .eq("id", queue.id)
          .maybeSingle();
        const websites = Array.isArray(
          (row as { websites?: unknown } | null)?.websites,
        )
          ? ([...(row as { websites: unknown[] }).websites] as string[])
          : [];
        if (!websites.some((w) => urlKey(String(w)) === urlKey(c.found))) {
          websites.push(c.found);
          patch.websites = websites;
          added.push(key);
        }
        continue;
      }
      if (mode === "add" && key === "email") {
        const { data: row } = await catalog
          .from("import_comment_recommendations")
          .select("notes")
          .eq("id", queue.id)
          .maybeSingle();
        const notes = String(
          (row as { notes?: string | null } | null)?.notes || "",
        );
        const emailMatch = notes.match(/emails:\s*([^;]*)/i);
        const existingEmails = (emailMatch?.[1] || "")
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean);
        if (
          !existingEmails.some((e) => emailKey(e) === emailKey(c.found))
        ) {
          existingEmails.push(c.found);
          const parts = notes
            .split(";")
            .map((p: string) => p.trim())
            .filter(Boolean)
            .filter((p: string) => !p.toLowerCase().startsWith("emails:"));
          parts.push(`emails: ${existingEmails.join(", ")}`);
          patch.notes = parts.join("; ");
          added.push(key);
        }
        continue;
      }
      // replace (and add→replace for non-appendable)
      if (key === "phone") {
        patch.phones = [c.found];
        replaced.push(key);
      } else if (key === "website") {
        patch.websites = [c.found];
        replaced.push(key);
      } else if (key === "instagram_url") {
        const handle = c.found
          .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
          .replace(/\/+$/, "")
          .replace(/^@/, "");
        if (handle) {
          patch.instagram = [handle];
          replaced.push(key);
        }
      } else if (key === "address_line") {
        patch.address_line = c.found;
        replaced.push(key);
      } else if (key === "email") {
        const { data: row } = await catalog
          .from("import_comment_recommendations")
          .select("notes")
          .eq("id", queue.id)
          .maybeSingle();
        const notes = String(
          (row as { notes?: string | null } | null)?.notes || "",
        );
        const parts = notes
          .split(";")
          .map((p: string) => p.trim())
          .filter(Boolean)
          .filter((p: string) => !p.toLowerCase().startsWith("emails:"));
        parts.push(`emails: ${c.found}`);
        patch.notes = parts.join("; ");
        replaced.push(key);
      }
    }
    const applied = [...replaced, ...added];
    if (!applied.length) {
      return { ok: false, message: "Нечего обновлять" };
    }
    const { error } = await catalog
      .from("import_comment_recommendations")
      .update(patch)
      .eq("id", queue.id);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin/recommendations");
    revalidatePath("/admin/review/inbox");
    return {
      ok: true,
      applied,
      replaced,
      added,
      message: formatConflictApplyMessage(replaced, added),
    };
  }

  if (queue?.source === "import_review") {
    for (const { key, mode } of resolved) {
      const c = byKey.get(key);
      if (!c?.found) continue;
      // Queue arrays: add appends, replace overwrites.
      if (mode === "add" && key === "phone") {
        const { data: row } = await catalog
          .from("import_review_items")
          .select("phone")
          .eq("id", queue.id)
          .maybeSingle();
        const phones = Array.isArray(
          (row as { phone?: unknown } | null)?.phone,
        )
          ? ([...(row as { phone: unknown[] }).phone] as string[])
          : [];
        const foundDigits = phoneDigitsKey(c.found);
        if (
          !phones.some((p) => phoneDigitsKey(String(p)) === foundDigits)
        ) {
          phones.push(c.found);
          patch.phone = phones;
          added.push(key);
        }
        continue;
      }
      if (mode === "add" && key === "email") {
        const { data: row } = await catalog
          .from("import_review_items")
          .select("email")
          .eq("id", queue.id)
          .maybeSingle();
        const emails = Array.isArray(
          (row as { email?: unknown } | null)?.email,
        )
          ? ([...(row as { email: unknown[] }).email] as string[])
          : [];
        if (!emails.some((e) => emailKey(String(e)) === emailKey(c.found))) {
          emails.push(c.found);
          patch.email = emails;
          added.push(key);
        }
        continue;
      }
      if (mode === "add" && key === "website") {
        const { data: row } = await catalog
          .from("import_review_items")
          .select("website")
          .eq("id", queue.id)
          .maybeSingle();
        const websites = Array.isArray(
          (row as { website?: unknown } | null)?.website,
        )
          ? ([...(row as { website: unknown[] }).website] as string[])
          : [];
        if (!websites.some((w) => urlKey(String(w)) === urlKey(c.found))) {
          websites.push(c.found);
          patch.website = websites;
          added.push(key);
        }
        continue;
      }
      if (key === "phone") {
        patch.phone = [c.found];
        replaced.push(key);
      } else if (key === "email") {
        patch.email = [c.found];
        replaced.push(key);
      } else if (key === "website") {
        patch.website = [c.found];
        replaced.push(key);
      } else if (key === "instagram_url") {
        const handle = c.found
          .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
          .replace(/\/+$/, "")
          .replace(/^@/, "");
        if (handle) {
          patch.instagram = [handle];
          replaced.push(key);
        }
      } else if (key === "address_line") {
        patch.address_line = c.found;
        replaced.push(key);
      } else if (key === "telegram_url") {
        const handle = c.found
          .replace(/^https?:\/\/t\.me\//i, "")
          .replace(/\/+$/, "")
          .replace(/^@/, "");
        if (handle) {
          patch.telegram_username = handle;
          replaced.push(key);
        }
      }
    }
    const applied = [...replaced, ...added];
    if (!applied.length) {
      return { ok: false, message: "Нечего обновлять" };
    }
    const { error } = await catalog
      .from("import_review_items")
      .update(patch)
      .eq("id", queue.id);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/admin/import-review");
    revalidatePath("/admin/review/inbox");
    return {
      ok: true,
      applied,
      replaced,
      added,
      message: formatConflictApplyMessage(replaced, added),
    };
  }

  const table = TABLE_BY_KIND[kind];
  const needsLinks = resolved.some(
    (a) =>
      a.mode === "add" &&
      ["phone", "email", "website", "instagram_url", "telegram_url"].includes(
        a.key,
      ),
  );
  let contactLinksRaw: unknown = null;
  if (needsLinks && (kind === "business" || kind === "professional" || kind === "church")) {
    const { data: row } = await catalog
      .from(table)
      .select("contact_links")
      .eq("id", entityId)
      .maybeSingle();
    contactLinksRaw = (row as { contact_links?: unknown } | null)?.contact_links;
  }

  let links = parseContactLinks(contactLinksRaw);
  let linksChanged = false;

  for (const { key, mode } of resolved) {
    const c = byKey.get(key);
    if (!c?.found) continue;

    if (mode === "add") {
      if (key === "address_line" && kind === "business") {
        const { extractUsStreetAddress } = await import(
          "@/lib/admin/paste-enrich"
        );
        const { addMissingBusinessLocations } = await import(
          "@/lib/business/import-locations"
        );
        const extracted = extractUsStreetAddress(c.found);
        const addr = extracted.addressLine
          ? extracted
          : {
              addressLine: c.found.trim(),
              city: null,
              state: null,
              postalCode: null,
              label: null,
            };
        if (!addr.addressLine) continue;
        const n = await addMissingBusinessLocations(catalog, entityId, [addr], {
          source: "enrich_conflict_add",
        });
        if (n > 0) added.push(key);
        continue;
      }
      if (key === "phone") {
        const next = appendContactLink(links, {
          channel: "custom",
          label: "Телефон",
          value: c.found,
        });
        if (next.length !== links.length) {
          links = next;
          linksChanged = true;
          added.push(key);
        }
        continue;
      }
      if (key === "email") {
        const next = appendContactLink(links, {
          channel: "custom",
          label: "Email",
          value: c.found,
        });
        if (next.length !== links.length) {
          links = next;
          linksChanged = true;
          added.push(key);
        }
        continue;
      }
      if (key === "website") {
        const next = appendContactLink(links, {
          channel: "website",
          value: c.found,
        });
        if (next.length !== links.length) {
          links = next;
          linksChanged = true;
          added.push(key);
        }
        continue;
      }
      if (key === "instagram_url") {
        const next = appendContactLink(links, {
          channel: "instagram",
          value: c.found,
        });
        if (next.length !== links.length) {
          links = next;
          linksChanged = true;
          added.push(key);
        }
        continue;
      }
      if (key === "telegram_url") {
        const next = appendContactLink(links, {
          channel: "telegram",
          value: c.found,
        });
        if (next.length !== links.length) {
          links = next;
          linksChanged = true;
          added.push(key);
        }
        continue;
      }
      continue;
    }

    // replace
    if (key === "address_line" && kind === "professional") {
      patch.private_address_line = c.found;
      replaced.push(key);
      continue;
    }
    if (key === "address_line" && kind === "business") {
      patch.address_line = c.found;
      replaced.push(key);
      continue;
    }
    if (key === "description") {
      patch.description = c.found;
      replaced.push(key);
      continue;
    }
    if (
      key === "phone" ||
      key === "email" ||
      key === "website" ||
      key === "instagram_url" ||
      key === "telegram_url"
    ) {
      patch[key] = c.found;
      replaced.push(key);
    }
  }

  if (linksChanged) {
    patch.contact_links = links;
  }

  const applied = [...replaced, ...added];
  if (!applied.length) {
    return { ok: false, message: "Нечего обновлять" };
  }

  // Only write entity row when patch has more than updated_at, or when we only added locations.
  const patchKeys = Object.keys(patch).filter((k) => k !== "updated_at");
  if (patchKeys.length > 0) {
    const { error } = await catalog
      .from(table)
      .update(patch)
      .eq("id", entityId);
    if (error) return { ok: false, message: error.message };
  } else if (!added.includes("address_line") || replaced.length) {
    // no-op safety
  }

  revalidatePath("/admin");
  if (kind === "business") {
    revalidatePath("/admin/businesses");
    revalidatePath("/admin/catalog/businesses");
  } else if (kind === "professional") {
    revalidatePath("/admin/catalog/professionals");
  }

  return {
    ok: true,
    applied,
    replaced,
    added,
    message: formatConflictApplyMessage(replaced, added),
  };
}

function formatConflictApplyMessage(
  replaced: string[],
  added: string[],
): string {
  const parts: string[] = [];
  if (replaced.length) {
    parts.push(
      `Заменено: ${replaced.map((k) => fieldLabelSafe(k)).join(", ")}`,
    );
  }
  if (added.length) {
    parts.push(`Добавлено: ${added.map((k) => fieldLabelSafe(k)).join(", ")}`);
  }
  return parts.join(" · ") || "Готово";
}

function fieldLabelSafe(key: string): string {
  const map: Record<string, string> = {
    phone: "телефон",
    email: "email",
    website: "сайт",
    instagram_url: "Instagram",
    telegram_url: "Telegram",
    address_line: "адрес",
    private_address_line: "адрес",
    description: "описание",
    short_description: "краткое описание",
    name: "название",
    display_name: "имя",
    city: "город",
    postal_code: "индекс",
    locations: "адреса офисов",
  };
  return map[key] ?? key;
}

/**
 * After dry-run enrich: write only the fields the admin checked, then history.
 */
export async function applyPublishedEnrichSelectionAction(input: {
  kind: PublishedEnrichKind;
  entityId: string;
  /** Keys from result.patch (and optional `locations`) to apply. */
  selectedKeys: string[];
  patch: Record<string, unknown>;
  /** Conflict rows still open — only selectedConflictKeys are replaced. */
  conflicts?: NonNullable<EnrichRunResult["field_conflicts"]>;
  selectedConflictKeys?: string[];
  extraAddresses?: string[];
  /** Full dry-run result for history (before snapshot, resources, …). */
  result?: EnrichRunResult;
}): Promise<
  | { ok: true; applied: string[]; message: string }
  | { ok: false; message: string }
> {
  const { kind, entityId } = input;
  if (!KINDS.has(kind)) return { ok: false, message: "Некорректный kind" };
  if (!entityId.trim()) return { ok: false, message: "Нужен entityId" };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Нужна авторизация" };
  if (!(await userIsAdmin(supabase)))
    return { ok: false, message: "Только для админов" };

  const selected = new Set(
    (input.selectedKeys ?? []).map((k) => k.trim()).filter(Boolean),
  );
  const conflictKeys = new Set(
    (input.selectedConflictKeys ?? []).map((k) => k.trim()).filter(Boolean),
  );
  const fullPatch = input.patch ?? {};
  const writePatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  const applied: string[] = [];

  for (const key of selected) {
    if (key === "locations") continue;
    if (key === "jobs") continue;
    if (LOCKED_KEYS.has(key)) continue;
    if (!(key in fullPatch)) continue;
    writePatch[key] = fullPatch[key];
    applied.push(key);
  }

  const byConflict = new Map(
    (input.conflicts ?? [])
      .filter((c) => c?.key && c.found)
      .map((c) => [c.key, c] as const),
  );
  for (const key of conflictKeys) {
    const c = byConflict.get(key);
    if (!c?.found) continue;
    if (key === "address_line" && kind === "professional") {
      writePatch.private_address_line = c.found;
      applied.push(key);
      continue;
    }
    if (key === "address_line" && kind === "business") {
      writePatch.address_line = c.found;
      applied.push(key);
      continue;
    }
    if (
      key === "phone" ||
      key === "email" ||
      key === "website" ||
      key === "instagram_url" ||
      key === "telegram_url" ||
      key === "description"
    ) {
      writePatch[key] = c.found;
      applied.push(key);
    }
  }

  const catalog = untyped(createServiceRoleClient());
  const table = TABLE_BY_KIND[kind];
  const patchKeys = Object.keys(writePatch).filter((k) => k !== "updated_at");
  if (patchKeys.length > 0) {
    const { error } = await catalog
      .from(table)
      .update(writePatch)
      .eq("id", entityId);
    if (error) return { ok: false, message: error.message };
  }

  if (
    selected.has("locations") &&
    kind === "business" &&
    (input.extraAddresses?.length || 0) > 0
  ) {
    const { extractUsStreetAddresses } = await import(
      "@/lib/admin/paste-enrich"
    );
    const { addMissingBusinessLocations } = await import(
      "@/lib/business/import-locations"
    );
    const hits = extractUsStreetAddresses(
      (input.extraAddresses ?? []).join("\n"),
    );
    if (hits.length) {
      const added = await addMissingBusinessLocations(
        catalog,
        entityId,
        hits,
        { source: "enrich_description" },
      );
      if (added) applied.push("locations");
    }
  }

  if (
    selected.has("jobs") &&
    (input.result?.pending_jobs?.length || 0) > 0
  ) {
    const { addMissingJobsFromAd } = await import("@/lib/jobs/from-ad-text");
    const drafts = (input.result?.pending_jobs ?? []).map((j) => ({
      title: j.title,
      description: j.description || j.title,
      addressLine: j.address_line,
      city: j.city,
      stateCode: j.state_code,
      postalCode: j.postal_code,
      latitude: j.latitude,
      longitude: j.longitude,
      locationPrecision: j.location_precision,
    }));
    let sourceUrl: string | null = null;
    if (kind === "business") {
      const { data: biz } = await catalog
        .from("businesses")
        .select("source_url")
        .eq("id", entityId)
        .maybeSingle();
      sourceUrl =
        typeof (biz as { source_url?: string | null } | null)?.source_url ===
        "string"
          ? String((biz as { source_url: string }).source_url)
          : null;
    }
    const added = await addMissingJobsFromAd(catalog, drafts, {
      businessId: kind === "business" ? entityId : null,
      sourceUrl,
      geocodeWorksite: false,
    });
    if (added) applied.push("jobs");
  }

  if (!applied.length) {
    return { ok: false, message: "Ничего не выбрано" };
  }

  const appliedPatch: Record<string, unknown> = {};
  for (const key of applied) {
    if (key === "locations" || key === "jobs") continue;
    if (key in writePatch) appliedPatch[key] = writePatch[key];
  }

  const historyResult: EnrichRunResult = {
    ...(input.result ?? {}),
    pending_review: false,
    patch: appliedPatch,
    field_conflicts: (input.conflicts ?? []).filter(
      (c) => !conflictKeys.has(c.key),
    ),
    reason: null,
  };

  try {
    const { writePublishedEnrichHistory } = await import(
      "@/lib/admin/published-enrich-history"
    );
    await writePublishedEnrichHistory({
      kind,
      entityId,
      adminId: user.id,
      result: historyResult,
    });
  } catch (err) {
    console.error("enrich selection history failed", err);
  }

  revalidatePath("/admin");
  if (kind === "business") {
    revalidatePath("/admin/businesses");
    revalidatePath("/admin/catalog/businesses");
    revalidatePath("/search");
  } else if (kind === "professional") {
    revalidatePath("/admin/catalog/professionals");
    revalidatePath("/professionals");
  }
  const slug =
    typeof writePatch.slug === "string"
      ? writePatch.slug
      : typeof input.result?.patch?.slug === "string"
        ? String(input.result.patch.slug)
        : null;
  if (kind === "business" && slug) revalidatePath(`/business/${slug}`);
  if (kind === "professional" && slug) revalidatePath(`/professional/${slug}`);

  return {
    ok: true,
    applied,
    message: `Сохранено: ${applied.map(fieldLabelSafe).join(", ")}`,
  };
}
