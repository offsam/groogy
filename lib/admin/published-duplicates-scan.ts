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
  citiesConflict,
  phoneDigits,
  websiteHost,
} from "@/lib/import-review/recommendation-duplicate";
import { isSharedNonIdentityHost } from "@/lib/import-review/shared-hosts";
import {
  buildCatalogMergeBaggage,
  CATALOG_MERGE_BAGGAGE_SELECT,
  enrichCatalogMergeChildren,
  preserveSecondaryMergeSource,
  retargetCatalogMergeProvenance,
} from "@/lib/admin/catalog-merge-baggage";
import { preferKeepSelfByFill } from "@/lib/admin/catalog-merge-keep";
import {
  canonicalDismissSides,
  isCatalogPairDismissed,
  loadCatalogDismissPairKeys,
} from "@/lib/admin/catalog-duplicate-dismissals";
import { employerRoleFromName } from "@/lib/admin/person-vs-firm";
import { slugifyProfessionalName } from "@/lib/professional/mappers";
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
  /** How many identity params overlap (phone+email+…). */
  matchCount?: number;
  /** Param labels that matched, e.g. phone, email, address. */
  matchParams?: string[];
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
  input: {
    entityType: "professional" | "business";
    entityId: string;
    /** Preloaded self row (queue card mapped to live shape). */
    selfRow?: Record<string, unknown>;
    /** Queue scan: never suggest dropping a live card into the queue id. */
    queueMode?: boolean;
  },
): Promise<ScanLiveDuplicatesResult> {
  const table =
    input.entityType === "professional" ? "professionals" : "businesses";

  let self: Record<string, unknown>;
  if (input.selfRow) {
    self = input.selfRow;
  } else {
    const { data: selfRaw, error: selfErr } = await anyFrom(catalog, table)
      .select(selectFor(input.entityType))
      .eq("id", input.entityId)
      .maybeSingle();
    if (selfErr) return { ok: false, message: selfErr.message };
    if (!selfRaw) return { ok: false, message: "Карточка не найдена" };
    self = selfRaw as Record<string, unknown>;
  }
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
  const selfCity = (self.city as string | null) ?? null;

  // Extra streets from business_locations (multi-office cards).
  const selfAddressKeys = new Set<string>();
  if (selfAddress) selfAddressKeys.add(selfAddress);
  if (input.entityType === "business" && !input.queueMode) {
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
      const keepSelf = input.queueMode
        ? false
        : preferKeepSelfByFill({
            selfKind: input.entityType as "business" | "professional",
            candidateKind: entityType,
            selfFill,
            candidateFill: fill,
          });
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
      const nameStrength = display === selfName ? "weak" : "exact";
      const matched = ((data ?? []) as Array<Record<string, unknown>>).filter(
        (r) => {
          if (
            normName(
              String(r.display_name || r.name || ""),
            ) !== key
          ) {
            return false;
          }
          // Common Russian names repeat across every diaspora metro — a
          // name-only ("weak") hit against a clearly different city is
          // almost always a coincidence, not a duplicate.
          if (
            nameStrength === "weak" &&
            citiesConflict(selfCity, (r.city as string | null) ?? null)
          ) {
            return false;
          }
          return true;
        },
      );
      await collectCatalog(entityType, matched, `name:${display}`, nameStrength);

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
        if (selfNameKeys.has(normName(String(r.display_name || r.name || "")))) {
          return false;
        }
        if (citiesConflict(selfCity, (r.city as string | null) ?? null)) {
          return false;
        }
        const blob = String(r.description || "");
        const blobKey = normName(blob);
        return [...selfNameKeys].some((k) => k.length >= 4 && blobKey.includes(k));
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

  const notes = finalizeScanNotes(scanNotes);

  let finalHits = hits;
  if (!input.queueMode) {
    try {
      const dismissed = await loadCatalogDismissPairKeys(catalog);
      finalHits = hits.filter((h) => {
        if (h.kind !== "catalog" || !h.entityType) return true;
        return !isCatalogPairDismissed(
          dismissed,
          { kind: input.entityType, id: input.entityId },
          { kind: h.entityType, id: h.id },
        );
      });
    } catch {
      /* ignore missing table */
    }
  }

  const catalogFinal = finalHits.filter((h) => h.kind === "catalog").length;
  const recFinal = finalHits.filter((h) => h.kind === "recommendation").length;
  const message =
    finalHits.length === 0
      ? `Совпадений не найдено${notes.length ? ` (${notes.join("; ")})` : ""}`
      : `Найдено: каталог ${catalogFinal}, рекомендации ${recFinal}`;

  return { ok: true, message, selfName, hits: finalHits, scanNotes: notes };
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

  const notes = finalizeScanNotes(scanNotes);
  let finalHits = hits;
  try {
    const dismissed = await loadCatalogDismissPairKeys(catalog);
    finalHits = hits.filter((h) => {
      if (h.kind !== "catalog" || !h.entityType) return true;
      return !isCatalogPairDismissed(
        dismissed,
        { kind: input.entityType, id: input.entityId },
        { kind: h.entityType, id: h.id },
      );
    });
  } catch {
    /* ignore */
  }
  const catalogFinal = finalHits.filter((h) => h.kind === "catalog").length;
  const recFinal = finalHits.filter((h) => h.kind === "recommendation").length;
  const message =
    finalHits.length === 0
      ? `Совпадений не найдено${notes.length ? ` (${notes.join("; ")})` : ""}`
      : `Найдено: каталог ${catalogFinal}, рекомендации ${recFinal}`;

  return { ok: true, message, selfName, hits: finalHits, scanNotes: notes };
}

/** Scan catalog twins (+ recommendations where applicable) for any live published kind. */
export async function scanLiveEntityDuplicatesAction(input: {
  entityType: LiveEntityKind;
  entityId: string;
  queue?: { source: "import_review" | "recommendation"; id: string };
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

  const entityType =
    input.entityType === "business" || input.entityType === "professional"
      ? input.entityType
      : null;

  if (input.queue) {
    if (!entityType) {
      return {
        ok: false,
        message: "Поиск двойников для этого типа очереди пока только business/professional",
      };
    }
    const selfRow = await loadQueueSelfRow(catalog, input.queue, entityType);
    if (!selfRow) {
      return { ok: false, message: "Карточка очереди не найдена" };
    }
    return scanBizProDuplicates(catalog, {
      entityType,
      entityId: input.queue.id,
      selfRow,
      queueMode: true,
    });
  }

  if (entityType) {
    return scanBizProDuplicates(catalog, {
      entityType,
      entityId: input.entityId,
    });
  }

  if (
    input.entityType === "event" ||
    input.entityType === "job" ||
    input.entityType === "service" ||
    input.entityType === "transfer" ||
    input.entityType === "marketplace" ||
    input.entityType === "lechu"
  ) {
    return scanOtherKindDuplicates(catalog, {
      entityType: input.entityType,
      entityId: input.entityId,
    });
  }

  return { ok: false, message: "Неизвестный тип карточки" };
}

function noteEmails(notes: string | null | undefined): string | null {
  if (!notes) return null;
  for (const part of notes.split(";")) {
    const p = part.trim();
    if (p.toLowerCase().startsWith("emails:")) {
      return p.slice("emails:".length).trim().split(",")[0]?.trim() || null;
    }
  }
  return null;
}

async function loadQueueSelfRow(
  catalog: SupabaseClient,
  queue: { source: "import_review" | "recommendation"; id: string },
  entityType: "business" | "professional",
): Promise<Record<string, unknown> | null> {
  if (queue.source === "recommendation") {
    const { data, error } = await anyFrom(
      catalog,
      "import_comment_recommendations",
    )
      .select(
        "id, display_name, phones, websites, instagram, notes, city, address_line, cover_image_url, source_post_urls",
      )
      .eq("id", queue.id)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    const phones = (row.phones as string[]) || [];
    const websites = (row.websites as string[]) || [];
    const ig = (row.instagram as string[]) || [];
    const igHandle = ig[0] ? String(ig[0]).replace(/^@/, "") : null;
    return {
      id: row.id,
      name: row.display_name,
      display_name: row.display_name,
      slug: null,
      phone: phones[0] || null,
      website: websites[0] || null,
      email: noteEmails(row.notes as string | null),
      instagram_url: igHandle
        ? `https://www.instagram.com/${igHandle}`
        : null,
      telegram_url: null,
      source_url: ((row.source_post_urls as string[]) || [])[0] || null,
      address_line: row.address_line,
      private_address_line: row.address_line,
      city: row.city,
      status: "pending",
    };
  }

  const { data, error } = await anyFrom(catalog, "import_review_items")
    .select(
      "id, title, business_name, person_name, phone, website, email, instagram, telegram_username, city, address_line, source_url, preview_image_url",
    )
    .eq("id", queue.id)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  const phones = (row.phone as string[]) || [];
  const websites = (row.website as string[]) || [];
  const emails = (row.email as string[]) || [];
  const ig = (row.instagram as string[]) || [];
  const igHandle = ig[0] ? String(ig[0]).replace(/^@/, "") : null;
  const name =
    entityType === "professional"
      ? row.person_name || row.title || row.business_name
      : row.business_name || row.title || row.person_name;
  return {
    id: row.id,
    name,
    display_name: name,
    slug: null,
    phone: phones[0] || null,
    website: websites[0] || null,
    email: emails[0] || null,
    instagram_url: igHandle
      ? `https://www.instagram.com/${igHandle}`
      : null,
    telegram_url: row.telegram_username
      ? `https://t.me/${row.telegram_username}`
      : null,
    source_url: row.source_url,
    address_line: row.address_line,
    private_address_line: row.address_line,
    city: row.city,
    status: "pending",
  };
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
 * Mark a catalog pair as «не двойник» — future scans skip it.
 */
export async function dismissCatalogDuplicatePairAction(input: {
  aKind: string;
  aId: string;
  bKind: string;
  bId: string;
}) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, message: "Нужно войти." };
  if (!(await userIsAdmin(supabase))) {
    return { ok: false as const, message: "Только для администраторов." };
  }
  const sides = canonicalDismissSides(
    { kind: input.aKind, id: input.aId },
    { kind: input.bKind, id: input.bId },
  );
  if (!sides) {
    return { ok: false as const, message: "Нужны две разные карточки." };
  }

  let catalog: ReturnType<typeof createServiceRoleClient>;
  try {
    catalog = createServiceRoleClient();
  } catch (err) {
    return {
      ok: false as const,
      message: err instanceof Error ? err.message : "Нет service role.",
    };
  }

  const { error } = await anyFrom(catalog, "catalog_duplicate_dismissals").upsert(
    {
      ...sides,
      created_by_profile_id: user.id,
    },
    { onConflict: "left_kind,left_id,right_kind,right_id" },
  );
  if (error) {
    return { ok: false as const, message: error.message };
  }
  return { ok: true as const, message: "Больше не предлагаем эту пару." };
}

/**
 * Firm stays as business; person becomes (or stays) a professional linked via
 * employer_business_id. Does not hard-merge into one business card.
 */
export async function attachCatalogEmployeeFromLiveScanAction(input: {
  firmId: string;
  personKind: "business" | "professional";
  personId: string;
  firmSlug?: string | null;
  personSlug?: string | null;
}) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, message: "Нужно войти." };
  if (!(await userIsAdmin(supabase))) {
    return { ok: false as const, message: "Только для администраторов." };
  }
  if (input.firmId === input.personId) {
    return { ok: false as const, message: "Нужны две разные карточки." };
  }

  let catalog: ReturnType<typeof createServiceRoleClient>;
  try {
    catalog = createServiceRoleClient();
  } catch (err) {
    return {
      ok: false as const,
      message: err instanceof Error ? err.message : "Нет service role.",
    };
  }

  const { data: firm, error: firmErr } = await anyFrom(catalog, "businesses")
    .select(CATALOG_MERGE_BAGGAGE_SELECT.business)
    .eq("id", input.firmId)
    .maybeSingle();
  if (firmErr || !firm) {
    return {
      ok: false as const,
      message: firmErr?.message || "Фирма не найдена.",
    };
  }

  const firmRow = firm as Record<string, unknown>;
  const firmName = String(firmRow.name || "").trim() || "компания";
  const firmSlug =
    input.firmSlug || String(firmRow.slug || "").trim() || null;
  const now = new Date().toISOString();

  if (input.personKind === "professional") {
    const { data: pro, error: proErr } = await anyFrom(catalog, "professionals")
      .select(CATALOG_MERGE_BAGGAGE_SELECT.professional)
      .eq("id", input.personId)
      .maybeSingle();
    if (proErr || !pro) {
      return {
        ok: false as const,
        message: proErr?.message || "Специалист не найден.",
      };
    }
    const proRow = pro as Record<string, unknown>;
    const role =
      employerRoleFromName(String(proRow.display_name || "")) || null;
    const { error: updErr } = await anyFrom(catalog, "professionals")
      .update({
        employer_business_id: input.firmId,
        employer_name: firmName.slice(0, 160),
        employer_role: role,
        updated_at: now,
      })
      .eq("id", input.personId);
    if (updErr) {
      return { ok: false as const, message: updErr.message };
    }
    if (firmSlug) revalidatePath(`/business/${firmSlug}`);
    const proSlug =
      input.personSlug || String(proRow.slug || "").trim() || null;
    if (proSlug) revalidatePath(`/professional/${proSlug}`);
    revalidatePath("/search");
    revalidatePath("/admin/catalog/businesses");
    revalidatePath("/admin/catalog/professionals");
    return {
      ok: true as const,
      message: `Привязано: ${String(proRow.display_name || "специалист")} → сотрудник «${firmName}».`,
      professionalSlug: proSlug,
    };
  }

  // Person is a mis-typed business card → create professional, destroy business.
  const { data: personBiz, error: personErr } = await anyFrom(
    catalog,
    "businesses",
  )
    .select(CATALOG_MERGE_BAGGAGE_SELECT.business)
    .eq("id", input.personId)
    .maybeSingle();
  if (personErr || !personBiz) {
    return {
      ok: false as const,
      message: personErr?.message || "Карточка человека не найдена.",
    };
  }
  const person = personBiz as Record<string, unknown>;
  const displayName = String(person.name || "").trim();
  if (displayName.length < 2) {
    return { ok: false as const, message: "У карточки человека нет имени." };
  }

  const role = employerRoleFromName(displayName);
  const firmWebsite = String(firmRow.website || "").trim().toLowerCase();
  const firmEmail = String(firmRow.email || "").trim().toLowerCase();
  const firmIg = String(firmRow.instagram_url || "").trim().toLowerCase();
  const firmPhone = String(firmRow.phone || "").trim();
  const firmDesc = String(firmRow.description || "").trim();

  let website = String(person.website || "").trim() || null;
  let email = String(person.email || "").trim() || null;
  let instagram = String(person.instagram_url || "").trim() || null;
  let phone = String(person.phone || "").trim() || null;
  if (website && firmWebsite && website.toLowerCase() === firmWebsite) {
    website = null;
  }
  if (email && firmEmail && email.toLowerCase() === firmEmail) {
    email = null;
  }
  if (instagram && firmIg && instagram.toLowerCase() === firmIg) {
    instagram = null;
  }
  if (phone && firmPhone && phone === firmPhone) {
    phone = null;
  }

  let description = String(person.description || "").trim() || null;
  const shortDescription =
    String(person.short_description || "").trim() || null;
  if (
    description &&
    firmDesc &&
    description.slice(0, 200).toLowerCase() === firmDesc.slice(0, 200).toLowerCase()
  ) {
    description = shortDescription;
  }

  const sameAddress =
    String(person.address_line || "")
      .trim()
      .toLowerCase() ===
      String(firmRow.address_line || "")
        .trim()
        .toLowerCase() && Boolean(String(person.address_line || "").trim());

  const slug = slugifyProfessionalName(displayName);
  const insertBody: Record<string, unknown> = {
    display_name: displayName.slice(0, 160),
    slug,
    headline: role,
    short_description: shortDescription?.slice(0, 400) ?? null,
    description: description?.slice(0, 4000) ?? null,
    image_url: person.image_url || null,
    status: "approved",
    visibility: "public",
    city: person.city || null,
    region: person.region || null,
    state_code: person.state_code || null,
    postal_code: person.postal_code || null,
    private_address_line: sameAddress
      ? null
      : String(person.address_line || "").trim() || null,
    phone,
    email,
    website,
    instagram_url: instagram,
    telegram_url: String(person.telegram_url || "").trim() || null,
    contact_links: person.contact_links ?? null,
    source_url: person.source_url || null,
    source_type: "IMPORT",
    category_id: person.category_id || null,
    employer_name: firmName.slice(0, 160),
    employer_role: role,
    employer_business_id: input.firmId,
    published_at: now,
    updated_at: now,
  };

  const { data: created, error: insErr } = await anyFrom(catalog, "professionals")
    .insert(insertBody)
    .select("id, slug, display_name")
    .maybeSingle();
  if (insErr || !created) {
    return {
      ok: false as const,
      message: insErr?.message || "Не удалось создать карточку специалиста.",
    };
  }
  const proId = String((created as { id: string }).id);
  const proSlug = String((created as { slug: string }).slug);

  await retargetCatalogMergeProvenance(catalog, {
    keepKind: "professional",
    keepId: proId,
    dropKind: "business",
    dropId: input.personId,
  });

  // Mentions: copy business → professional then drop.
  const { data: dropMentions } = await anyFrom(
    catalog,
    "business_community_mentions",
  )
    .select(
      "kind, source_channel, source_label, source_url, source_record_id, status, published_at",
    )
    .eq("business_id", input.personId)
    .limit(200);
  for (const row of (dropMentions ?? []) as Array<Record<string, unknown>>) {
    await anyFrom(catalog, "professional_community_mentions").insert({
      professional_id: proId,
      kind: row.kind ?? "third_party_recommendation",
      source_channel: row.source_channel ?? null,
      source_label: row.source_label ?? null,
      source_url: row.source_url ?? null,
      source_record_id: row.source_record_id
        ? String(row.source_record_id)
        : null,
      status: row.status ?? "published",
      published_at: row.published_at ?? now,
    });
  }
  await anyFrom(catalog, "business_community_mentions")
    .delete()
    .eq("business_id", input.personId);

  const { error: delErr } = await anyFrom(catalog, "businesses")
    .delete()
    .eq("id", input.personId);
  if (delErr) {
    const { error: archErr } = await anyFrom(catalog, "businesses")
      .update({ status: "archived", updated_at: now })
      .eq("id", input.personId);
    if (archErr) {
      return { ok: false as const, message: archErr.message };
    }
  }

  if (firmSlug) revalidatePath(`/business/${firmSlug}`);
  revalidatePath(`/professional/${proSlug}`);
  const oldSlug =
    input.personSlug || String(person.slug || "").trim() || null;
  if (oldSlug) revalidatePath(`/business/${oldSlug}`);
  revalidatePath("/search");
  revalidatePath("/admin/catalog/businesses");
  revalidatePath("/admin/catalog/professionals");

  return {
    ok: true as const,
    message: `Привязано: «${displayName}» → специалист, сотрудник «${firmName}».`,
    professionalSlug: proSlug,
  };
}

export async function mergeCatalogDuplicateFromLiveScanAction(input: {
  /** Type of the card being kept. */
  keepKind: "business" | "professional";
  /** Type of the card being dropped. */
  dropKind: "business" | "professional";
  keepId: string;
  dropId: string;
  keepSlug?: string | null;
  dropSlug?: string | null;
  /** Default merge. attach_employee: keep=firm business, drop=person. */
  mode?: "merge" | "attach_employee";
}) {
  if (input.mode === "attach_employee") {
    if (input.keepKind !== "business") {
      return {
        ok: false as const,
        message: "Привязка сотрудника: фирма должна быть бизнесом.",
      };
    }
    return attachCatalogEmployeeFromLiveScanAction({
      firmId: input.keepId,
      personKind: input.dropKind,
      personId: input.dropId,
      firmSlug: input.keepSlug,
      personSlug: input.dropSlug,
    });
  }

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
        ? CATALOG_MERGE_BAGGAGE_SELECT.business
        : CATALOG_MERGE_BAGGAGE_SELECT.professional,
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
        ? CATALOG_MERGE_BAGGAGE_SELECT.business
        : CATALOG_MERGE_BAGGAGE_SELECT.professional,
    )
    .eq("id", input.dropId)
    .maybeSingle();
  if (dropErr || !dropRow) {
    return {
      ok: false as const,
      message: dropErr?.message || "Карточка-дубль не найдена.",
    };
  }

  const baggage = buildCatalogMergeBaggage({
    keepKind: input.keepKind,
    dropKind: input.dropKind,
    keep: keepRow as Record<string, unknown>,
    drop: dropRow as Record<string, unknown>,
  });
  const filled = baggage.filled;

  if (Object.keys(baggage.patch).length > 0) {
    const { error: patchErr } = await anyFrom(catalog, keepTable)
      .update({
        ...baggage.patch,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.keepId);
    if (patchErr) {
      return { ok: false as const, message: patchErr.message };
    }
  }

  await retargetCatalogMergeProvenance(catalog, {
    keepKind: input.keepKind,
    keepId: input.keepId,
    dropKind: input.dropKind,
    dropId: input.dropId,
  });

  if (baggage.secondarySourceUrl) {
    await preserveSecondaryMergeSource(catalog, {
      keepKind: input.keepKind,
      keepId: input.keepId,
      sourceUrl: baggage.secondarySourceUrl,
      label: baggage.secondarySourceLabel,
      dropId: input.dropId,
    });
  }

  const childFilled = await enrichCatalogMergeChildren(catalog, {
    keepKind: input.keepKind,
    keepId: input.keepId,
    dropKind: input.dropKind,
    dropId: input.dropId,
    keep: keepRow as Record<string, unknown>,
    drop: dropRow as Record<string, unknown>,
  });
  filled.push(...childFilled);

  // Community mention rows: same-type retarget FK; cross-type copy then drop.
  const dropMentionTable =
    input.dropKind === "professional"
      ? "professional_community_mentions"
      : "business_community_mentions";
  const dropMentionFk =
    input.dropKind === "professional" ? "professional_id" : "business_id";
  const keepMentionTable =
    input.keepKind === "professional"
      ? "professional_community_mentions"
      : "business_community_mentions";
  const keepMentionFk =
    input.keepKind === "professional" ? "professional_id" : "business_id";

  const { data: dropMentions } = await anyFrom(catalog, dropMentionTable)
    .select(
      "id, kind, source_channel, source_label, source_url, source_record_id, snippet, author_label, status, published_at",
    )
    .eq(dropMentionFk, input.dropId)
    .limit(200);

  if (input.keepKind === input.dropKind) {
    await anyFrom(catalog, dropMentionTable)
      .update({ [keepMentionFk]: input.keepId })
      .eq(dropMentionFk, input.dropId);
  } else {
    for (const row of (dropMentions ?? []) as Array<Record<string, unknown>>) {
      const sourceRecordId = row.source_record_id
        ? String(row.source_record_id)
        : null;
      if (sourceRecordId) {
        const { data: existing } = await anyFrom(catalog, keepMentionTable)
          .select("id")
          .eq(keepMentionFk, input.keepId)
          .eq("source_record_id", sourceRecordId)
          .maybeSingle();
        if (existing) continue;
      }
      const insertBody: Record<string, unknown> = {
        [keepMentionFk]: input.keepId,
        kind: row.kind ?? "third_party_recommendation",
        source_channel: row.source_channel ?? null,
        source_label: row.source_label ?? null,
        source_url: row.source_url ?? null,
        source_record_id: sourceRecordId,
        status: row.status ?? "published",
        published_at: row.published_at ?? new Date().toISOString(),
      };
      if (input.keepKind === "business") {
        insertBody.snippet = row.snippet ?? null;
        insertBody.author_label = row.author_label ?? null;
      }
      await anyFrom(catalog, keepMentionTable).insert(insertBody);
    }
    await anyFrom(catalog, dropMentionTable)
      .delete()
      .eq(dropMentionFk, input.dropId);
  }

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
