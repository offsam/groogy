import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { stateCodeFromText } from "@/lib/address/normalize";
import {
  extractUsStreetAddresses,
  parsePasteEnrichText,
  pasteEnrichFillEmptyPatch,
  type PasteEnrichExisting,
} from "@/lib/admin/paste-enrich";
import { fetchWebsiteVisibleText } from "@/lib/admin/published-finalize-enrich";
import type { PublishedEnrichKind } from "@/lib/admin/published-enrich-run";
import type {
  EnrichResourceState,
  EnrichRunResult,
  EnrichStreamEvent,
} from "@/lib/import-review/enrich-progress";
import { parseContactLinks } from "@/lib/contacts/channels";

type Push = (event: EnrichStreamEvent) => void;

const EXTRA_PATHS = ["/", "/contact", "/contacts", "/about", "/menu"];

function untyped(client: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client as unknown as SupabaseClient<any>;
}

function tableFor(kind: PublishedEnrichKind): string {
  if (kind === "business") return "businesses";
  if (kind === "professional") return "professionals";
  if (kind === "event") return "events";
  if (kind === "job") return "jobs";
  if (kind === "church") return "churches";
  return "listings";
}

function selectFor(kind: PublishedEnrichKind): string {
  if (kind === "business") {
    return "id, slug, name, phone, email, website, instagram_url, telegram_url, yelp_url, google_maps_url, google_rating, google_reviews_count, city, state_code, address_line, postal_code, description, short_description, opening_hours, source_url";
  }
  if (kind === "professional") {
    return "id, slug, display_name, phone, email, website, instagram_url, telegram_url, city, state_code, private_address_line, postal_code, description, short_description, opening_hours, source_url";
  }
  return "*";
}

function igUrl(raw: string): string {
  const v = raw.trim().replace(/^@/, "");
  if (/^https?:\/\//i.test(v)) return v;
  return `https://instagram.com/${v}`;
}

function tgUrl(raw: string): string {
  const v = raw.trim().replace(/^@/, "");
  if (/^https?:\/\//i.test(v)) return v;
  return `https://t.me/${v}`;
}

function existingFromRow(
  row: Record<string, unknown>,
  kind: PublishedEnrichKind,
): PasteEnrichExisting {
  const links = parseContactLinks(row.contact_links);
  const facebook = links.find((l) => l.channel === "facebook")?.value ?? null;
  return {
    name:
      kind === "professional"
        ? ((row.display_name as string | null) ?? null)
        : ((row.name as string | null) ?? null),
    phone: (row.phone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    instagram: (row.instagram_url as string | null) ?? null,
    telegram: (row.telegram_url as string | null) ?? null,
    facebook,
    yelp: (row.yelp_url as string | null) ?? null,
    googleMaps: (row.google_maps_url as string | null) ?? null,
    googleRating:
      typeof row.google_rating === "number" ? row.google_rating : null,
    googleReviewsCount:
      typeof row.google_reviews_count === "number"
        ? row.google_reviews_count
        : null,
    city: (row.city as string | null) ?? null,
    state: (row.state_code as string | null) ?? null,
    addressLine:
      kind === "professional"
        ? ((row.private_address_line as string | null) ?? null)
        : ((row.address_line as string | null) ?? null),
    postalCode: (row.postal_code as string | null) ?? null,
    description:
      (row.description as string | null) ||
      (row.short_description as string | null) ||
      null,
    openingHours: (row.opening_hours as PasteEnrichExisting["openingHours"]) ?? null,
  };
}

function logicalToDbPatch(
  kind: PublishedEnrichKind,
  logical: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (logical.name) {
    patch[kind === "professional" ? "display_name" : "name"] = logical.name;
  }
  if (Array.isArray(logical.phone) && logical.phone[0]) {
    patch.phone = logical.phone[0];
  }
  if (Array.isArray(logical.email) && logical.email[0]) {
    patch.email = logical.email[0];
  }
  if (Array.isArray(logical.website) && logical.website[0]) {
    const preferred =
      logical.website.find(
        (u) => !/gumroad\.com|pdf|maps\.app|wtsp\.cc|wa\.me/i.test(String(u)),
      ) || logical.website[0];
    if (preferred) patch.website = preferred;
  }
  if (Array.isArray(logical.instagram) && logical.instagram[0]) {
    patch.instagram_url = igUrl(String(logical.instagram[0]));
  }
  if (logical.telegram) patch.telegram_url = tgUrl(String(logical.telegram));
  if (kind === "business" && typeof logical.yelp === "string" && logical.yelp) {
    patch.yelp_url = logical.yelp;
  }
  if (logical.googleMaps && kind !== "professional") {
    patch.google_maps_url = logical.googleMaps;
  }
  if (logical.googleRating != null) patch.google_rating = logical.googleRating;
  if (typeof logical.googleReviewsCount === "number") {
    patch.google_reviews_count = logical.googleReviewsCount;
  }
  if (logical.city) patch.city = logical.city;
  if (logical.state) {
    const code = stateCodeFromText(String(logical.state));
    if (code) patch.state_code = code;
  }
  if (logical.addressLine) {
    patch[kind === "professional" ? "private_address_line" : "address_line"] =
      logical.addressLine;
  }
  if (logical.postalCode) patch.postal_code = logical.postalCode;
  if (logical.description) patch.description = logical.description;
  if (logical.openingHours) patch.opening_hours = logical.openingHours;
  return patch;
}

function scalar(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return String(value[0] ?? "").trim();
  return String(value).trim();
}

/**
 * Website/source crawl without Python — same extractors as paste-enrich.
 * Used on Vercel where spawn(python3) cannot run.
 */
export async function runPublishedEnrichNode(input: {
  client: SupabaseClient;
  kind: PublishedEnrichKind;
  id: string;
  push: Push;
  signal?: AbortSignal;
}): Promise<EnrichRunResult> {
  const { client, kind, id, push, signal } = input;
  const table = tableFor(kind);
  const { data, error } = await untyped(client)
    .from(table)
    .select(selectFor(kind))
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Карточка не найдена");

  const row = data as unknown as Record<string, unknown>;
  const existing = existingFromRow(row, kind);
  const website = String(row.website || "").trim() || null;
  const sourceUrl = String(row.source_url || "").trim() || null;
  const cardCopy = [row.description, row.short_description]
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .join("\n\n");

  const resources: EnrichResourceState[] = [];
  const texts: string[] = [];
  let menuText: string | null = null;

  const visit = async (url: string, resKind: string, path = "/") => {
    if (signal?.aborted) return;
    push({
      type: "resource",
      url: path === "/" ? url : `${url.replace(/\/$/, "")}${path}`,
      kind: resKind,
      status: "running",
    });
    const text = await fetchWebsiteVisibleText(url, path);
    const fields: string[] = [];
    if (text && text.length >= 80) {
      texts.push(text);
      const parsed = parsePasteEnrichText(text);
      if (parsed.phone.length) fields.push("phone");
      if (parsed.email.length) fields.push("email");
      if (parsed.website.length) fields.push("website");
      if (parsed.instagram.length) fields.push("instagram");
      if (parsed.addressLine) fields.push("address");
      if (parsed.openingHours) fields.push("hours");
      if (path === "/menu") menuText = text;
    }
    const outcome = text && text.length >= 80 ? "ok" : "empty";
    const state: EnrichResourceState = {
      url: path === "/" ? url : `${url.replace(/\/$/, "")}${path}`,
      kind: resKind,
      status: outcome === "ok" ? "done" : "done",
      outcome,
      fields,
    };
    resources.push(state);
    push({
      type: "resource",
      url: state.url,
      kind: resKind,
      status: "done",
      outcome,
      fields,
    });
  };

  if (cardCopy.length >= 40) {
    texts.push(cardCopy);
    push({
      type: "resource",
      url: "card://copy",
      kind: "card",
      status: "done",
      outcome: "ok",
      fields: ["description"],
    });
    resources.push({
      url: "card://copy",
      kind: "card",
      status: "done",
      outcome: "ok",
      fields: ["description"],
    });
  }

  if (website) {
    for (const path of EXTRA_PATHS) {
      if (signal?.aborted) break;
      await visit(website, path === "/menu" ? "menu" : "website", path);
    }
  }
  if (sourceUrl && sourceUrl !== website) {
    await visit(sourceUrl, "source", "/");
  }

  const blob = texts.join("\n\n").slice(0, 80_000);
  const extracted = parsePasteEnrichText(blob);
  const logical = pasteEnrichFillEmptyPatch(existing, extracted, null);
  const patch = logicalToDbPatch(kind, logical);
  delete patch.updated_at;

  const conflicts: NonNullable<EnrichRunResult["field_conflicts"]> = [];
  const maybeConflict = (
    key: string,
    current: unknown,
    found: unknown,
  ) => {
    const a = scalar(current);
    const b = scalar(found);
    if (!a || !b) return;
    if (a.toLowerCase() === b.toLowerCase()) return;
    conflicts.push({ key, current: a, found: b });
  };
  maybeConflict("phone", existing.phone, extracted.phone[0]);
  maybeConflict("email", existing.email, extracted.email[0]);
  maybeConflict("website", existing.website, extracted.website[0]);
  maybeConflict(
    "instagram_url",
    existing.instagram,
    extracted.instagram[0] ? igUrl(extracted.instagram[0]) : null,
  );
  maybeConflict("address_line", existing.addressLine, extracted.addressLine);
  maybeConflict("description", existing.description, extracted.description);

  const extra = extractUsStreetAddresses(blob)
    .map((s) => s.addressLine)
    .filter((line): line is string => Boolean(line))
    .filter(
      (line) =>
        line.toLowerCase() !== String(existing.addressLine || "").toLowerCase() &&
        line.toLowerCase() !== String(extracted.addressLine || "").toLowerCase(),
    )
    .slice(0, 8);

  const okN = resources.filter((r) => r.outcome === "ok").length;
  const failN = resources.filter(
    (r) => r.outcome === "empty" || r.outcome === "error",
  ).length;

  return {
    id,
    skipped: false,
    pending_review: true,
    patch,
    field_conflicts: conflicts,
    extra_addresses: extra,
    menu_text: menuText,
    resources,
    resources_ok: okN,
    resources_failed: failN,
    reason:
      Object.keys(patch).length || conflicts.length
        ? null
        : "Готово — новых полей не нашлось (fill-empty).",
  };
}
