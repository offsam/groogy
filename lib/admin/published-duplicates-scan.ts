"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeBusinessesAction } from "@/lib/business/admin-actions";
import {
  confirmRecommendationMergeAction,
  rejectCommentRecommendationAction,
} from "@/lib/import-review/recommendation-actions";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";
import { repeatedBrandFromText } from "@/lib/import-review/display-name";
import {
  phoneDigits,
  websiteHost,
} from "@/lib/import-review/recommendation-duplicate";
import { isSharedNonIdentityHost } from "@/lib/import-review/shared-hosts";
import { userIsAdmin } from "@/lib/reviews/queries";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

export type LiveDuplicateKind = "catalog" | "recommendation";

export type LiveEntityKind =
  | "professional"
  | "business"
  | "event"
  | "job"
  | "service"
  | "transfer"
  | "marketplace"
  | "lechu";

export type LiveDuplicateHit = {
  kind: LiveDuplicateKind;
  strength: "exact" | "weak";
  reason: string;
  id: string;
  entityType?: LiveEntityKind;
  slug?: string | null;
  name: string;
  href?: string | null;
  fillScore?: number;
  suggestedKeepId?: string;
  suggestedDropId?: string;
  status?: string | null;
};

function publicHrefFor(
  kind: LiveEntityKind,
  id: string,
  slug: string | null | undefined,
): string | null {
  if (kind === "professional" && slug) return `/professional/${slug}`;
  if (kind === "business" && slug) return `/business/${slug}`;
  if (kind === "event" && slug) return `/events/${slug}`;
  if (kind === "job" && slug) return `/jobs/${slug}`;
  if (kind === "service") return `/services/${id}`;
  if (kind === "transfer") return `/transfers/${id}`;
  if (kind === "marketplace") return `/marketplace/${id}`;
  if (kind === "lechu") return `/lechu/${id}`;
  return null;
}

function normUrl(raw: string | null | undefined): string {
  return (raw || "").trim().replace(/\/+$/, "").toLowerCase();
}

export type ScanLiveDuplicatesResult =
  | {
      ok: true;
      message: string;
      selfName: string;
      hits: LiveDuplicateHit[];
      scanNotes?: string[];
    }
  | { ok: false; message: string };

function anyFrom(client: SupabaseClient, table: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic admin tables
  return (client as any).from(table);
}

/** Columns needed for live duplicate matching — avoid select("*"). */
const REC_SCAN_SELECT =
  "id, display_name, phones, websites, instagram, comment_texts, request_snippets, source_post_urls, status, kind, mention_count, third_party_mention_count, self_ad_mention_count, duplicate_of_entity_id, duplicate_of_entity_type, duplicate_reason";

function recommendationsTable(client: SupabaseClient) {
  return anyFrom(client, "import_comment_recommendations");
}

/** True for PostgREST/Postgres "missing column" noise (never show raw SQL). */
function isMissingColumnError(message: string): boolean {
  const msg = message.trim();
  if (!msg) return false;
  if (/does not exist/i.test(msg) && /column/i.test(msg)) return true;
  if (/Could not find the ['"]?\w+['"]? column/i.test(msg)) return true;
  if (/schema cache/i.test(msg) && /column/i.test(msg)) return true;
  return false;
}

/** Push a query failure into scan notes; never leave a bare Postgres line. */
function noteQueryError(scanNotes: string[], where: string, message: string) {
  const msg = (message || "").trim();
  if (!msg) return;
  if (isMissingColumnError(msg)) {
    // Log the real signal so we can find broken SQL (e.g. k.author_id) in server logs.
    console.warn(`[duplicates-scan] ${where}: ${msg}`);
    scanNotes.push(
      `${where}: схема БД не совпала (внутренний столбец) — этот сигнал пропущен`,
    );
    return;
  }
  scanNotes.push(`${where}: ${msg}`);
}

function finalizeScanNotes(notes: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let sawSchemaNoise = false;
  for (const n of notes) {
    const t = n.trim();
    if (!t) continue;
    // Drop raw SQL entirely — never show Postgres internals in the admin UI.
    if (
      isMissingColumnError(t) ||
      /^column\b/i.test(t) ||
      /\bauthor_id\b/i.test(t)
    ) {
      console.warn(`[duplicates-scan] dropped note: ${t}`);
      sawSchemaNoise = true;
      continue;
    }
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  if (sawSchemaNoise) {
    const soft =
      "Один внутренний сигнал поиска пропущен (схема БД) — каталог выше всё равно полный";
    if (!seen.has(soft)) {
      seen.add(soft);
      out.push(soft);
    }
  }
  // Final strip — never return SQL fragments to the client.
  return out.filter(
    (n) =>
      !/does not exist/i.test(n) &&
      !/^column\b/i.test(n) &&
      !/\bauthor_id\b/i.test(n),
  );
}

function nonemptyCount(row: Record<string, unknown>, keys: string[]): number {
  let n = 0;
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) n += 1;
  }
  return n;
}

function normName(raw: string | null | undefined): string {
  return (raw || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .slice(0, 80);
}

function emailNorm(raw: string | null | undefined): string | null {
  const e = (raw || "").trim().toLowerCase();
  if (!e || !e.includes("@") || e.length < 5) return null;
  return e;
}

/** `instagram.com/oway` / `@oway` → `oway`. */
function instagramHandle(raw: string | null | undefined): string | null {
  const t = (raw || "").trim();
  if (!t) return null;
  try {
    if (/instagram\.com/i.test(t)) {
      const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
      const handle = u.pathname.split("/").filter(Boolean)[0] || "";
      return handle.replace(/^@/, "").toLowerCase() || null;
    }
  } catch {
    /* plain handle */
  }
  const handle = t.replace(/^@/, "").replace(/\/+$/, "").toLowerCase();
  if (!/^[a-z0-9._]{2,30}$/.test(handle)) return null;
  if (["p", "reel", "reels", "stories", "explore"].includes(handle)) return null;
  return handle;
}

function telegramKey(raw: string | null | undefined): string | null {
  const t = (raw || "").trim();
  if (!t) return null;
  try {
    if (/t\.me|telegram\./i.test(t)) {
      const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
      const part = u.pathname.split("/").filter(Boolean)[0] || "";
      return part.replace(/^@/, "").toLowerCase() || null;
    }
  } catch {
    /* plain */
  }
  const handle = t.replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_]{3,32}$/.test(handle) ? handle : null;
}

/** Street identity: house number + first street token + ZIP when present. */
function addressKey(raw: string | null | undefined): string | null {
  const t = (raw || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (t.length < 8) return null;
  const m = t.match(
    /(\d{1,6})\s+([a-z0-9.'-]+(?:\s+[a-z0-9.'-]+){0,4})\s+(?:ave|avenue|st|street|blvd|boulevard|rd|road|dr|drive|way|ln|lane|ct|court|pl|place|hwy|highway)\b/,
  );
  if (!m) return null;
  const zip = t.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] ?? "";
  return `${m[1]}${m[2].replace(/[^a-z0-9]+/g, "")}${zip}`;
}

/**
 * Names that identify this card beyond the title: the brand the ad itself
 * repeats (same rules as enrich — skips «City — Venue» pickup partners).
 */
function identityNamesFromCard(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  const title = String(row.display_name || row.name || "").trim();
  if (title) out.push(title);
  const blob = [row.description, row.short_description]
    .filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
    .join("\n");
  const brand = repeatedBrandFromText(blob);
  if (brand) out.push(brand);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const name of out) {
    const key = normName(name);
    if (key.length < 4 || seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }
  return unique;
}

const FILL_KEYS = [
  "phone",
  "website",
  "email",
  "instagram_url",
  "telegram_url",
  "description",
  "short_description",
  "image_url",
  "private_address_line",
  "address_line",
  "city",
] as const;

const PRO_SELECT =
  "id, slug, display_name, phone, website, email, instagram_url, telegram_url, source_url, description, short_description, image_url, private_address_line, city, status";

const BIZ_SELECT =
  "id, slug, name, phone, website, email, instagram_url, telegram_url, source_url, description, short_description, image_url, address_line, city, status";

function selectFor(entityType: "professional" | "business"): string {
  return entityType === "professional" ? PRO_SELECT : BIZ_SELECT;
}

async function requireAdminClient(): Promise<
  | { supabase: SupabaseClient; error?: undefined }
  | { supabase?: undefined; error: ScanLiveDuplicatesResult }
> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: { ok: false, message: "Нужна авторизация" } };
  if (!(await userIsAdmin(supabase))) {
    return { error: { ok: false, message: "Только для админов" } };
  }
  return { supabase };
}

async function scanBizProDuplicates(
  catalog: SupabaseClient,
  input: { entityType: "professional" | "business"; entityId: string },
): Promise<ScanLiveDuplicatesResult> {
  const table =
    input.entityType === "professional" ? "professionals" : "businesses";

  const { data: selfRaw, error: selfErr } = await anyFrom(catalog, table)
    .select(selectFor(input.entityType))
    .eq("id", input.entityId)
    .maybeSingle();
  if (selfErr) return { ok: false, message: selfErr.message };
  if (!selfRaw) return { ok: false, message: "Карточка не найдена" };

  const self = selfRaw as Record<string, unknown>;
  const selfName = String(
    (self.display_name as string) || (self.name as string) || self.slug || "—",
  );
  const selfPhone = phoneDigits((self.phone as string | null) || "");
  const selfEmail = emailNorm(self.email as string | null);
  const selfIg = instagramHandle(self.instagram_url as string | null);
  const selfTg = telegramKey(self.telegram_url as string | null);
  const selfSource = normUrl(self.source_url as string | null);
  const rawSelfHost = websiteHost(self.website as string | null);
  const selfHostIsShared = isSharedNonIdentityHost(rawSelfHost);
  const selfHost = selfHostIsShared ? null : rawSelfHost;
  const selfAddress = addressKey(
    (self.address_line as string) ||
      (self.private_address_line as string) ||
      "",
  );
  const selfIdentityNames = identityNamesFromCard(self);
  const selfNameKeys = new Set(selfIdentityNames.map(normName));
  const selfFill = nonemptyCount(self, [...FILL_KEYS]);

  // Extra streets from business_locations (multi-office cards).
  const selfAddressKeys = new Set<string>();
  if (selfAddress) selfAddressKeys.add(selfAddress);
  if (input.entityType === "business") {
    const { data: locs } = await anyFrom(catalog, "business_locations")
      .select("address_line, postal_code")
      .eq("business_id", input.entityId)
      .eq("status", "published")
      .limit(20);
    for (const loc of (locs ?? []) as Array<{
      address_line: string | null;
      postal_code: string | null;
    }>) {
      const key = addressKey(
        [loc.address_line, loc.postal_code].filter(Boolean).join(", "),
      );
      if (key) selfAddressKeys.add(key);
    }
  }

  const hits: LiveDuplicateHit[] = [];
  /** Stronger reason wins when the same card is hit twice. */
  const seenCatalog = new Map<
    string,
    { strength: "exact" | "weak"; index: number }
  >();
  const scanNotes: string[] = [];

  function strengthRank(s: "exact" | "weak"): number {
    return s === "exact" ? 2 : 1;
  }

  async function collectCatalog(
    entityType: "professional" | "business",
    rows: Array<Record<string, unknown>>,
    reason: string,
    strength: "exact" | "weak",
  ) {
    for (const row of rows) {
      const id = String(row.id);
      if (id === input.entityId) continue;
      const key = `${entityType}:${id}`;
      const prev = seenCatalog.get(key);
      if (prev && strengthRank(prev.strength) >= strengthRank(strength)) {
        continue;
      }
      const fill = nonemptyCount(row, [...FILL_KEYS]);
      const name = String(
        (row.display_name as string) || (row.name as string) || row.slug || "—",
      );
      const slug = (row.slug as string) || null;
      // Prefer live business over professional when folding the same person.
      const keepSelf =
        input.entityType === "business" && entityType === "professional"
          ? true
          : input.entityType === "professional" && entityType === "business"
            ? false
            : selfFill >= fill;
      const hit: LiveDuplicateHit = {
        kind: "catalog",
        strength,
        reason,
        id,
        entityType,
        slug,
        name,
        href: publicHrefFor(entityType, id, slug),
        fillScore: fill,
        suggestedKeepId: keepSelf ? input.entityId : id,
        suggestedDropId: keepSelf ? id : input.entityId,
        status: (row.status as string) || null,
      };
      if (prev) {
        hits[prev.index] = hit;
        seenCatalog.set(key, { strength, index: prev.index });
      } else {
        seenCatalog.set(key, { strength, index: hits.length });
        hits.push(hit);
      }
    }
  }

  async function scanBothTables(
    apply: (
      entityType: "professional" | "business",
      tableName: string,
    ) => Promise<void>,
  ) {
    await apply("professional", "professionals");
    await apply("business", "businesses");
  }

  // --- exact contact / source signals (both sections) ---
  if (selfPhone.length >= 10) {
    const tail = selfPhone.slice(-10);
    await scanBothTables(async (entityType, tableName) => {
      const { data, error } = await anyFrom(catalog, tableName)
        .select(selectFor(entityType))
        .eq("status", "approved")
        .ilike("phone", `%${tail}%`)
        .limit(40);
      if (error) noteQueryError(scanNotes, `phone/${entityType}`, error.message);
      const matched = ((data ?? []) as Array<Record<string, unknown>>).filter(
        (r) => phoneDigits(r.phone as string | null) === selfPhone,
      );
      await collectCatalog(entityType, matched, `phone:${selfPhone}`, "exact");
    });
  } else {
    scanNotes.push("Нет телефона — поиск по телефону пропущен");
  }

  if (selfHost) {
    await scanBothTables(async (entityType, tableName) => {
      const { data, error } = await anyFrom(catalog, tableName)
        .select(selectFor(entityType))
        .eq("status", "approved")
        .ilike("website", `%${selfHost}%`)
        .limit(25);
      if (error) {
        noteQueryError(scanNotes, `website/${entityType}`, error.message);
      }
      const matched = ((data ?? []) as Array<Record<string, unknown>>).filter(
        (r) => websiteHost(r.website as string | null) === selfHost,
      );
      await collectCatalog(
        entityType,
        matched,
        `website:${selfHost}`,
        "exact",
      );
    });
  } else if (selfHostIsShared) {
    scanNotes.push(
      `Сайт ${rawSelfHost} общий для многих карточек — поиск по сайту пропущен`,
    );
  } else {
    scanNotes.push("Нет website — поиск по сайту пропущен");
  }

  if (selfEmail) {
    await scanBothTables(async (entityType, tableName) => {
      const { data, error } = await anyFrom(catalog, tableName)
        .select(selectFor(entityType))
        .eq("status", "approved")
        .ilike("email", selfEmail)
        .limit(20);
      if (error) noteQueryError(scanNotes, `email/${entityType}`, error.message);
      const matched = ((data ?? []) as Array<Record<string, unknown>>).filter(
        (r) => emailNorm(r.email as string | null) === selfEmail,
      );
      await collectCatalog(entityType, matched, `email:${selfEmail}`, "exact");
    });
  } else {
    scanNotes.push("Нет email — поиск по email пропущен");
  }

  if (selfIg) {
    await scanBothTables(async (entityType, tableName) => {
      const { data, error } = await anyFrom(catalog, tableName)
        .select(selectFor(entityType))
        .eq("status", "approved")
        .ilike("instagram_url", `%${selfIg}%`)
        .limit(25);
      if (error) {
        noteQueryError(scanNotes, `instagram/${entityType}`, error.message);
      }
      const matched = ((data ?? []) as Array<Record<string, unknown>>).filter(
        (r) => instagramHandle(r.instagram_url as string | null) === selfIg,
      );
      await collectCatalog(
        entityType,
        matched,
        `instagram:@${selfIg}`,
        "exact",
      );
    });
  } else {
    scanNotes.push("Нет Instagram — поиск по Instagram пропущен");
  }

  if (selfTg) {
    await scanBothTables(async (entityType, tableName) => {
      const { data, error } = await anyFrom(catalog, tableName)
        .select(selectFor(entityType))
        .eq("status", "approved")
        .ilike("telegram_url", `%${selfTg}%`)
        .limit(20);
      if (error) {
        noteQueryError(scanNotes, `telegram/${entityType}`, error.message);
      }
      const matched = ((data ?? []) as Array<Record<string, unknown>>).filter(
        (r) => telegramKey(r.telegram_url as string | null) === selfTg,
      );
      await collectCatalog(
        entityType,
        matched,
        `telegram:@${selfTg}`,
        "exact",
      );
    });
  }

  if (selfSource) {
    await scanBothTables(async (entityType, tableName) => {
      const { data, error } = await anyFrom(catalog, tableName)
        .select(selectFor(entityType))
        .eq("status", "approved")
        .eq("source_url", self.source_url as string)
        .limit(25);
      if (error) {
        noteQueryError(scanNotes, `source_url/${entityType}`, error.message);
      }
      const matched = ((data ?? []) as Array<Record<string, unknown>>).filter(
        (r) => normUrl(r.source_url as string | null) === selfSource,
      );
      await collectCatalog(
        entityType,
        matched,
        `source_url:${selfSource}`,
        "exact",
      );
    });
  } else {
    scanNotes.push("Нет source_url — поиск по источнику пропущен");
  }

  // Street address — card fields + (for businesses) business_locations.
  if (selfAddressKeys.size > 0) {
    const streetNeedles = [...selfAddressKeys]
      .map((k) => k.replace(/\d{5}$/, "").slice(0, 12))
      .filter((n) => n.length >= 5);
    await scanBothTables(async (entityType, tableName) => {
      const addrCol =
        entityType === "professional" ? "private_address_line" : "address_line";
      const matched: Array<Record<string, unknown>> = [];
      for (const needle of streetNeedles.slice(0, 3)) {
        const { data, error } = await anyFrom(catalog, tableName)
          .select(selectFor(entityType))
          .eq("status", "approved")
          .ilike(addrCol, `%${needle.slice(0, 8)}%`)
          .limit(30);
        if (error) {
          noteQueryError(scanNotes, `address/${entityType}`, error.message);
          break;
        }
        for (const row of (data ?? []) as Array<Record<string, unknown>>) {
          const key = addressKey(
            String(row.address_line || row.private_address_line || ""),
          );
          if (key && selfAddressKeys.has(key)) matched.push(row);
        }
      }
      if (entityType === "business") {
        for (const key of selfAddressKeys) {
          const house = key.match(/^\d+/)?.[0];
          if (!house) continue;
          const { data: locRows } = await anyFrom(catalog, "business_locations")
            .select("business_id, address_line, postal_code")
            .eq("status", "published")
            .ilike("address_line", `${house}%`)
            .limit(40);
          const ids = [
            ...new Set(
              ((locRows ?? []) as Array<{
                business_id: string;
                address_line: string | null;
                postal_code: string | null;
              }>)
                .filter((loc) => {
                  const k = addressKey(
                    [loc.address_line, loc.postal_code]
                      .filter(Boolean)
                      .join(", "),
                  );
                  return k === key;
                })
                .map((loc) => loc.business_id),
            ),
          ].filter((id) => id !== input.entityId);
          if (!ids.length) continue;
          const { data: bizRows } = await anyFrom(catalog, "businesses")
            .select(selectFor(entityType))
            .eq("status", "approved")
            .in("id", ids.slice(0, 20));
          matched.push(...((bizRows ?? []) as Array<Record<string, unknown>>));
        }
      }
      await collectCatalog(
        entityType,
        matched,
        `address:${[...selfAddressKeys][0]}`,
        "exact",
      );
    });
  } else {
    scanNotes.push("Нет уличного адреса — поиск по адресу пропущен");
  }

  // Names: card title + brand repeated in description (OWAY Cargo on a «SAida» card).
  for (const display of selfIdentityNames) {
    const key = normName(display);
    if (key.length < 4) continue;
    const needle = display.slice(0, 40);
    await scanBothTables(async (entityType, tableName) => {
      const nameCol = entityType === "professional" ? "display_name" : "name";
      const { data, error } = await anyFrom(catalog, tableName)
        .select(selectFor(entityType))
        .eq("status", "approved")
        .ilike(nameCol, `%${needle}%`)
        .limit(20);
      if (error) noteQueryError(scanNotes, `name/${entityType}`, error.message);
      const matched = ((data ?? []) as Array<Record<string, unknown>>).filter(
        (r) =>
          normName(
            String(r.display_name || r.name || ""),
          ) === key,
      );
      await collectCatalog(
        entityType,
        matched,
        `name:${display}`,
        display === selfName ? "weak" : "exact",
      );

      // Other card's description names our brand / title.
      const { data: byDesc, error: descErr } = await anyFrom(catalog, tableName)
        .select(selectFor(entityType))
        .eq("status", "approved")
        .ilike("description", `%${needle}%`)
        .limit(25);
      if (descErr) {
        noteQueryError(scanNotes, `description/${entityType}`, descErr.message);
      }
      const descMatched = (
        (byDesc ?? []) as Array<Record<string, unknown>>
      ).filter((r) => {
        const blob = String(r.description || "");
        const blobKey = normName(blob);
        return selfNameKeys.has(normName(String(r.display_name || r.name || "")))
          ? false
          : [...selfNameKeys].some((k) => k.length >= 4 && blobKey.includes(k));
      });
      await collectCatalog(
        entityType,
        descMatched,
        `description:${display}`,
        "weak",
      );
    });
  }

  // --- recommendations: same contact / source / name / brand signals ---
  const { data: recRows, error: recErr } = await recommendationsTable(catalog)
    .select(REC_SCAN_SELECT)
    .in("status", ["pending", "suspected_duplicate"])
    .neq("kind", "event")
    .order("mention_count", { ascending: false })
    .limit(400);
  if (recErr) {
    noteQueryError(scanNotes, "рекомендации", recErr.message);
  }

  for (const raw of ((recErr ? [] : recRows) ?? []) as CommentRecommendation[]) {
    const item: CommentRecommendation = {
      ...raw,
      phones: raw.phones || [],
      websites: raw.websites || [],
      instagram: raw.instagram || [],
      comment_texts: raw.comment_texts || [],
      request_snippets: raw.request_snippets || [],
      source_post_urls: raw.source_post_urls || [],
      third_party_mention_count: Number(raw.third_party_mention_count ?? 0),
      self_ad_mention_count: Number(raw.self_ad_mention_count ?? 0),
      mention_count: Number(raw.mention_count ?? 1),
    };

    let reason: string | null = null;
    let strength: "exact" | "weak" = "weak";

    if (
      item.duplicate_of_entity_id === input.entityId &&
      item.duplicate_of_entity_type === input.entityType
    ) {
      reason = item.duplicate_reason || "suspected";
      strength =
        (item.duplicate_reason || "").startsWith("phone:") ||
        (item.duplicate_reason || "").startsWith("website:") ||
        (item.duplicate_reason || "").startsWith("instagram:") ||
        (item.duplicate_reason || "").startsWith("source_url:")
          ? "exact"
          : "weak";
    } else {
      if (selfHost) {
        for (const w of item.websites || []) {
          if (websiteHost(w) === selfHost) {
            reason = `website:${selfHost}`;
            strength = "exact";
            break;
          }
        }
      }
      if (!reason && selfPhone.length >= 10) {
        for (const p of item.phones || []) {
          if (phoneDigits(p) === selfPhone) {
            reason = `phone:${selfPhone}`;
            strength = "exact";
            break;
          }
        }
      }
      if (!reason && selfIg) {
        for (const ig of item.instagram || []) {
          if (instagramHandle(ig) === selfIg) {
            reason = `instagram:@${selfIg}`;
            strength = "exact";
            break;
          }
        }
      }
      if (!reason && selfSource) {
        for (const url of item.source_post_urls || []) {
          if (normUrl(url) === selfSource) {
            reason = `source_url:${selfSource}`;
            strength = "exact";
            break;
          }
        }
      }
      if (!reason && selfNameKeys.size) {
        const itemName = normName(item.display_name);
        if (itemName && selfNameKeys.has(itemName)) {
          reason = `name:${item.display_name}`;
          strength = "weak";
        } else {
          const blob = normName(
            [
              item.display_name,
              ...(item.comment_texts || []).slice(0, 3),
              ...(item.request_snippets || []).slice(0, 3),
            ]
              .filter(Boolean)
              .join(" "),
          );
          for (const k of selfNameKeys) {
            if (k.length >= 5 && blob.includes(k)) {
              reason = `description:${k}`;
              strength = "weak";
              break;
            }
          }
        }
      }
    }

    if (!reason) continue;

    hits.push({
      kind: "recommendation",
      strength,
      reason,
      id: item.id,
      name: item.display_name || "Рекомендация",
      href: `/admin/recommendations?q=${item.id}`,
      status: item.status,
    });
  }

  const catalogN = hits.filter((h) => h.kind === "catalog").length;
  const recN = hits.filter((h) => h.kind === "recommendation").length;
  const notes = finalizeScanNotes(scanNotes);
  const message =
    hits.length === 0
      ? `Совпадений не найдено${notes.length ? ` (${notes.join("; ")})` : ""}`
      : `Найдено: каталог ${catalogN}, рекомендации ${recN}`;

  return { ok: true, message, selfName, hits, scanNotes: notes };
}

async function scanOtherKindDuplicates(
  catalog: SupabaseClient,
  input: {
    entityType:
      | "event"
      | "job"
      | "service"
      | "transfer"
      | "marketplace"
      | "lechu";
    entityId: string;
  },
): Promise<ScanLiveDuplicatesResult> {
  const kind = input.entityType;
  const listingType =
    kind === "marketplace"
      ? "marketplace_item"
      : kind === "lechu"
        ? "transport_carry"
        : kind;
  const isListing = !["event", "job"].includes(kind);
  const table = kind === "event" ? "events" : kind === "job" ? "jobs" : "listings";
  const select =
    kind === "event"
      ? "id, slug, title, phone, registration_url, source_url, description, city, cover_image_url, status"
      : kind === "job"
        ? "id, slug, title, source_url, description, city, status"
        : "id, title, source_url, description, city, status, listing_type";
  const statusEq = kind === "event" || kind === "job" ? "published" : "active";
  const fillKeys =
    kind === "event"
      ? ["phone", "registration_url", "source_url", "description", "city", "cover_image_url"]
      : ["source_url", "description", "city"];

  const selfQuery = anyFrom(catalog, table).select(select).eq("id", input.entityId);
  const { data: selfRaw, error: selfErr } = await selfQuery.maybeSingle();
  if (selfErr) return { ok: false, message: selfErr.message };
  if (!selfRaw) return { ok: false, message: "Карточка не найдена" };

  const self = selfRaw as Record<string, unknown>;
  if (isListing && self.listing_type && self.listing_type !== listingType) {
    return { ok: false, message: `Ожидался listing_type=${listingType}` };
  }

  const selfName = String((self.title as string) || self.slug || "—");
  const selfPhone = phoneDigits((self.phone as string | null) || "");
  const selfSource = normUrl(self.source_url as string | null);
  const rawRegHost = websiteHost(
    (self.registration_url as string | null) || null,
  );
  const selfRegHost = isSharedNonIdentityHost(rawRegHost) ? null : rawRegHost;
  const selfNameKey = normName((self.title as string) || "");
  const selfFill = nonemptyCount(self, fillKeys);

  const hits: LiveDuplicateHit[] = [];
  const seenCatalog = new Set<string>();
  const scanNotes: string[] = [];

  function collect(
    rows: Array<Record<string, unknown>>,
    reason: string,
    strength: "exact" | "weak",
  ) {
    for (const row of rows) {
      const id = String(row.id);
      if (id === input.entityId) continue;
      if (isListing && row.listing_type && row.listing_type !== listingType) continue;
      const key = `${kind}:${id}`;
      if (seenCatalog.has(key)) continue;
      seenCatalog.add(key);
      const fill = nonemptyCount(row, fillKeys);
      const name = String((row.title as string) || row.slug || "—");
      const slug = (row.slug as string) || null;
      hits.push({
        kind: "catalog",
        strength,
        reason,
        id,
        entityType: kind,
        slug,
        name,
        href: publicHrefFor(kind, id, slug),
        fillScore: fill,
        suggestedKeepId: selfFill >= fill ? input.entityId : id,
        suggestedDropId: selfFill >= fill ? id : input.entityId,
        status: (row.status as string) || null,
      });
    }
  }

  function baseListQuery() {
    let q = anyFrom(catalog, table).select(select).eq("status", statusEq);
    if (isListing) q = q.eq("listing_type", listingType);
    return q;
  }

  if (selfSource) {
    const { data, error } = await baseListQuery()
      .eq("source_url", self.source_url as string)
      .limit(25);
    if (error) noteQueryError(scanNotes, "source_url", error.message);
    else {
      const matched = ((data ?? []) as Array<Record<string, unknown>>).filter(
        (r) => normUrl(r.source_url as string | null) === selfSource,
      );
      collect(matched, `source_url:${selfSource}`, "exact");
    }
  } else {
    scanNotes.push("Нет source_url — поиск по источнику пропущен");
  }

  if (kind === "event" && selfPhone.length >= 10) {
    const tail = selfPhone.slice(-10);
    const { data, error } = await baseListQuery()
      .ilike("phone", `%${tail}%`)
      .limit(40);
    if (error) noteQueryError(scanNotes, "phone", error.message);
    else {
      const matched = ((data ?? []) as Array<Record<string, unknown>>).filter(
        (r) => phoneDigits(r.phone as string | null) === selfPhone,
      );
      collect(matched, `phone:${selfPhone}`, "exact");
    }
  } else if (kind === "event") {
    scanNotes.push("Нет телефона — поиск по телефону пропущен");
  }

  if (kind === "event" && selfRegHost) {
    const { data, error } = await baseListQuery()
      .ilike("registration_url", `%${selfRegHost}%`)
      .limit(25);
    if (error) noteQueryError(scanNotes, "registration_url", error.message);
    else {
      const matched = ((data ?? []) as Array<Record<string, unknown>>).filter(
        (r) =>
          websiteHost(r.registration_url as string | null) === selfRegHost,
      );
      collect(matched, `registration_url:${selfRegHost}`, "exact");
    }
  }

  if (selfNameKey.length >= 4) {
    const display = ((self.title as string) || "").trim();
    const needle = display.slice(0, 40);
    if (needle.length >= 3) {
      const { data, error } = await baseListQuery()
        .ilike("title", `%${needle}%`)
        .limit(20);
      if (error) noteQueryError(scanNotes, "title", error.message);
      else {
        const matched = ((data ?? []) as Array<Record<string, unknown>>).filter(
          (r) => normName((r.title as string) || "") === selfNameKey,
        );
        collect(matched, `title:${display}`, "weak");
      }
    }
  }

  if (kind === "event") {
    const { data: recRows, error: recErr } = await recommendationsTable(catalog)
      .select(REC_SCAN_SELECT)
      .eq("kind", "event")
      .in("status", ["pending", "suspected_duplicate"])
      .order("mention_count", { ascending: false })
      .limit(200);
    if (recErr) noteQueryError(scanNotes, "рекомендации", recErr.message);
    else {
      for (const raw of (recRows ?? []) as CommentRecommendation[]) {
        const item: CommentRecommendation = {
          ...raw,
          phones: raw.phones || [],
          websites: raw.websites || [],
          third_party_mention_count: Number(
            raw.third_party_mention_count ?? 0,
          ),
          self_ad_mention_count: Number(raw.self_ad_mention_count ?? 0),
          mention_count: Number(raw.mention_count ?? 1),
        };
        let reason: string | null = null;
        let strength: "exact" | "weak" = "weak";
        if (
          item.duplicate_of_entity_id === input.entityId &&
          item.duplicate_of_entity_type === "event"
        ) {
          reason = item.duplicate_reason || "suspected";
          strength = "exact";
        } else if (selfPhone.length >= 10) {
          for (const p of item.phones || []) {
            if (phoneDigits(p) === selfPhone) {
              reason = `phone:${selfPhone}`;
              strength = "exact";
              break;
            }
          }
        }
        if (!reason && selfNameKey.length >= 4) {
          if (normName(item.display_name) === selfNameKey) {
            reason = `name:${item.display_name}`;
            strength = "weak";
          }
        }
        if (!reason) continue;
        hits.push({
          kind: "recommendation",
          strength,
          reason,
          id: item.id,
          name: item.display_name || "Рекомендация",
          href: `/admin/recommendations?q=${item.id}`,
          status: item.status,
        });
      }
    }
  } else {
    scanNotes.push("Очередь рекомендаций для этого типа не подключена — только каталог");
  }

  const catalogN = hits.filter((h) => h.kind === "catalog").length;
  const recN = hits.filter((h) => h.kind === "recommendation").length;
  const notes = finalizeScanNotes(scanNotes);
  const message =
    hits.length === 0
      ? `Совпадений не найдено${notes.length ? ` (${notes.join("; ")})` : ""}`
      : `Найдено: каталог ${catalogN}, рекомендации ${recN}`;

  return { ok: true, message, selfName, hits, scanNotes: notes };
}

/** Scan catalog twins (+ recommendations where applicable) for any live published kind. */
export async function scanLiveEntityDuplicatesAction(input: {
  entityType: LiveEntityKind;
  entityId: string;
}): Promise<ScanLiveDuplicatesResult> {
  const auth = await requireAdminClient();
  if (auth.error) return auth.error;

  let catalog: SupabaseClient;
  try {
    catalog = createServiceRoleClient();
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? err.message
          : "Нет service role — поиск двойников недоступен",
    };
  }

  if (
    input.entityType === "business" ||
    input.entityType === "professional"
  ) {
    return scanBizProDuplicates(catalog, {
      entityType: input.entityType,
      entityId: input.entityId,
    });
  }

  return scanOtherKindDuplicates(catalog, {
    entityType: input.entityType,
    entityId: input.entityId,
  });
}

/** Attach recommendation to this live card (fill-empty + mention counter). */
export async function attachRecommendationFromLiveScanAction(input: {
  recommendationId: string;
  entityType: "professional" | "business";
  entityId: string;
}) {
  return confirmRecommendationMergeAction({
    id: input.recommendationId,
    entityType: input.entityType,
    entityId: input.entityId,
  });
}

/** Reject a recommendation from the live-card duplicate UI. */
export async function rejectRecommendationFromLiveScanAction(input: {
  recommendationId: string;
}) {
  return rejectCommentRecommendationAction({ id: input.recommendationId });
}

/**
 * Merge two catalog cards from live duplicate scan.
 * - business + business → admin_merge_businesses
 * - professional folded into business (or two professionals) → fill-empty + archive drop
 */
export async function mergeCatalogDuplicateFromLiveScanAction(input: {
  /** Type of the card being kept. */
  keepKind: "business" | "professional";
  /** Type of the card being dropped. */
  dropKind: "business" | "professional";
  keepId: string;
  dropId: string;
  keepSlug?: string | null;
  dropSlug?: string | null;
}) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, message: "Нужно войти." };
  if (!(await userIsAdmin(supabase))) {
    return { ok: false as const, message: "Только для администраторов." };
  }
  if (input.keepId === input.dropId) {
    return { ok: false as const, message: "Нужны две разные карточки." };
  }

  if (input.keepKind === "business" && input.dropKind === "business") {
    const res = await mergeBusinessesAction({
      keepId: input.keepId,
      dropId: input.dropId,
      keepSlug: input.keepSlug,
      dropSlug: input.dropSlug,
    });
    if (res.ok) revalidatePath("/search");
    return res;
  }

  // Cross-type or professional↔professional: fill-empty keep, destroy drop.
  let catalog: ReturnType<typeof createServiceRoleClient>;
  try {
    catalog = createServiceRoleClient();
  } catch (err) {
    return {
      ok: false as const,
      message: err instanceof Error ? err.message : "Нет service role.",
    };
  }

  const keepTable =
    input.keepKind === "business" ? "businesses" : "professionals";
  const dropTable =
    input.dropKind === "business" ? "businesses" : "professionals";

  const { data: keepRow, error: keepErr } = await anyFrom(catalog, keepTable)
    .select(
      input.keepKind === "business"
        ? "id, slug, name, phone, email, website, instagram_url, telegram_url, google_maps_url, city, state_code, address_line, postal_code, description, short_description, image_url, contact_links"
        : "id, slug, display_name, phone, email, website, instagram_url, telegram_url, city, state_code, private_address_line, postal_code, description, short_description, image_url, contact_links",
    )
    .eq("id", input.keepId)
    .maybeSingle();
  if (keepErr || !keepRow) {
    return {
      ok: false as const,
      message: keepErr?.message || "Карточка-якорь не найдена.",
    };
  }

  const { data: dropRow, error: dropErr } = await anyFrom(catalog, dropTable)
    .select(
      input.dropKind === "business"
        ? "id, slug, name, phone, email, website, instagram_url, telegram_url, google_maps_url, city, state_code, address_line, postal_code, description, short_description, image_url, contact_links, status"
        : "id, slug, display_name, phone, email, website, instagram_url, telegram_url, city, state_code, private_address_line, postal_code, description, short_description, image_url, contact_links, status",
    )
    .eq("id", input.dropId)
    .maybeSingle();
  if (dropErr || !dropRow) {
    return {
      ok: false as const,
      message: dropErr?.message || "Карточка-дубль не найдена.",
    };
  }

  const empty = (v: unknown) =>
    v == null || (typeof v === "string" && !v.trim());

  const keepPatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  const filled: string[] = [];

  const copyIfEmpty = (
    keepKey: string,
    dropKey: string,
    label: string,
  ) => {
    const cur = (keepRow as Record<string, unknown>)[keepKey];
    const next = (dropRow as Record<string, unknown>)[dropKey];
    if (empty(cur) && !empty(next)) {
      keepPatch[keepKey] = next;
      filled.push(label);
    }
  };

  copyIfEmpty("phone", "phone", "телефон");
  copyIfEmpty("email", "email", "email");
  copyIfEmpty("website", "website", "сайт");
  copyIfEmpty("instagram_url", "instagram_url", "instagram");
  copyIfEmpty("telegram_url", "telegram_url", "telegram");
  if (input.keepKind === "business") {
    copyIfEmpty("google_maps_url", "google_maps_url", "карты");
    copyIfEmpty("address_line", "address_line", "адрес");
    if (
      empty((keepRow as { address_line?: string }).address_line) &&
      !empty((dropRow as { private_address_line?: string }).private_address_line)
    ) {
      keepPatch.address_line = (
        dropRow as { private_address_line: string }
      ).private_address_line;
      filled.push("адрес");
    }
  } else {
    copyIfEmpty("private_address_line", "private_address_line", "адрес");
    if (
      empty((keepRow as { private_address_line?: string }).private_address_line) &&
      !empty((dropRow as { address_line?: string }).address_line)
    ) {
      keepPatch.private_address_line = (
        dropRow as { address_line: string }
      ).address_line;
      filled.push("адрес");
    }
  }
  copyIfEmpty("city", "city", "город");
  copyIfEmpty(
    input.keepKind === "business" ? "state_code" : "state_code",
    "state_code",
    "штат",
  );
  copyIfEmpty("postal_code", "postal_code", "ZIP");
  copyIfEmpty("image_url", "image_url", "фото");
  if (
    empty((keepRow as { description?: string }).description) &&
    !empty((dropRow as { description?: string }).description)
  ) {
    keepPatch.description = (dropRow as { description: string }).description;
    filled.push("описание");
  }

  if (Object.keys(keepPatch).length > 1) {
    const { error: patchErr } = await anyFrom(catalog, keepTable)
      .update(keepPatch)
      .eq("id", input.keepId);
    if (patchErr) {
      return { ok: false as const, message: patchErr.message };
    }
  }

  // Retarget open recommendations that pointed at the dropped card.
  await recommendationsTable(catalog)
    .update({
      published_entity_type: input.keepKind,
      published_entity_id: input.keepId,
      updated_at: new Date().toISOString(),
    })
    .eq("published_entity_id", input.dropId)
    .eq("published_entity_type", input.dropKind);

  // R01: destroy donor after fill-empty (not leave archived ghosts).
  const { error: delErr } = await anyFrom(catalog, dropTable)
    .delete()
    .eq("id", input.dropId);
  if (delErr) {
    // FK block → archive as last resort so merge still completes.
    const { error: archErr } = await anyFrom(catalog, dropTable)
      .update({
        status: "archived",
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.dropId);
    if (archErr) {
      return { ok: false as const, message: archErr.message };
    }
  }

  const keepSlug =
    input.keepSlug ||
    String((keepRow as { slug?: string }).slug || "");
  const dropSlug =
    input.dropSlug ||
    String((dropRow as { slug?: string }).slug || "");
  if (input.keepKind === "business" && keepSlug) {
    revalidatePath(`/business/${keepSlug}`);
  }
  if (input.keepKind === "professional" && keepSlug) {
    revalidatePath(`/professional/${keepSlug}`);
  }
  if (input.dropKind === "business" && dropSlug) {
    revalidatePath(`/business/${dropSlug}`);
  }
  if (input.dropKind === "professional" && dropSlug) {
    revalidatePath(`/professional/${dropSlug}`);
  }
  revalidatePath("/search");
  revalidatePath("/admin/catalog/businesses");
  revalidatePath("/admin/catalog/professionals");

  const dropLabel =
    input.dropKind === "business" ? "бизнес" : "специалист";
  return {
    ok: true as const,
    message: filled.length
      ? `Объединено: ${dropLabel} удалён, добавлено ${filled.join(", ")}.`
      : `Объединено: ${dropLabel} удалён (новых полей не было).`,
  };
}
