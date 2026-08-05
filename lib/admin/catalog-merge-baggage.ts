/**
 * Shared fill-empty + provenance baggage when gluing catalog cards.
 * Keep wins on conflicts; donor only fills gaps and adds its source trail.
 */

import {
  parseContactLinks,
  serializeContactLinks,
  type ContactLink,
} from "@/lib/contacts/channels";
import { isEmptyMergeValue } from "@/lib/import-review/merge-contract";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CatalogMergeEntityKind = "business" | "professional";

export function normalizeMergeSourceUrl(
  url: string | null | undefined,
): string | null {
  const t = String(url || "")
    .trim()
    .replace(/\/+$/, "");
  if (!t) return null;
  try {
    const u = new URL(t.includes("://") ? t : `https://${t}`);
    return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, "").toLowerCase();
  } catch {
    return t.toLowerCase();
  }
}

/** Union jsonb contact_links (TikTok, WhatsApp, …) without dropping keep rows. */
export function unionContactLinks(keep: unknown, drop: unknown): ContactLink[] {
  return serializeContactLinks([
    ...parseContactLinks(keep),
    ...parseContactLinks(drop),
  ]);
}

export type CatalogMergeBaggage = {
  patch: Record<string, unknown>;
  filled: string[];
  /** Donor profile source_url to keep as a secondary trail (keep already has one). */
  secondarySourceUrl: string | null;
  secondarySourceLabel: string | null;
};

function copyIfEmpty(
  patch: Record<string, unknown>,
  filled: string[],
  keep: Record<string, unknown>,
  drop: Record<string, unknown>,
  keepKey: string,
  dropKey: string,
  label: string,
) {
  if (
    isEmptyMergeValue(keep[keepKey]) &&
    !isEmptyMergeValue(drop[dropKey])
  ) {
    patch[keepKey] = drop[dropKey];
    filled.push(label);
  }
}

/**
 * Build the keep-row patch: empty columns + contact_links union + source fill.
 * Does not destroy the donor; caller applies patch then retargets / deletes.
 */
export function buildCatalogMergeBaggage(input: {
  keepKind: CatalogMergeEntityKind;
  dropKind: CatalogMergeEntityKind;
  keep: Record<string, unknown>;
  drop: Record<string, unknown>;
}): CatalogMergeBaggage {
  const { keep, drop, keepKind, dropKind } = input;
  const patch: Record<string, unknown> = {};
  const filled: string[] = [];

  copyIfEmpty(patch, filled, keep, drop, "phone", "phone", "телефон");
  copyIfEmpty(patch, filled, keep, drop, "email", "email", "email");
  copyIfEmpty(patch, filled, keep, drop, "website", "website", "сайт");
  copyIfEmpty(
    patch,
    filled,
    keep,
    drop,
    "instagram_url",
    "instagram_url",
    "instagram",
  );
  copyIfEmpty(
    patch,
    filled,
    keep,
    drop,
    "telegram_url",
    "telegram_url",
    "telegram",
  );
  copyIfEmpty(
    patch,
    filled,
    keep,
    drop,
    "booking_url",
    "booking_url",
    "запись",
  );
  if (keepKind === "business") {
    copyIfEmpty(patch, filled, keep, drop, "yelp_url", "yelp_url", "yelp");
  }
  copyIfEmpty(patch, filled, keep, drop, "city", "city", "город");
  copyIfEmpty(patch, filled, keep, drop, "state_code", "state_code", "штат");
  copyIfEmpty(patch, filled, keep, drop, "region", "region", "регион");
  copyIfEmpty(patch, filled, keep, drop, "postal_code", "postal_code", "ZIP");
  copyIfEmpty(patch, filled, keep, drop, "image_url", "image_url", "фото");
  copyIfEmpty(
    patch,
    filled,
    keep,
    drop,
    "category_id",
    "category_id",
    "категория",
  );
  if (keepKind === "professional") {
    copyIfEmpty(patch, filled, keep, drop, "headline", "headline", "роль");
    copyIfEmpty(
      patch,
      filled,
      keep,
      drop,
      "availability_text",
      "availability_text",
      "доступность",
    );
    copyIfEmpty(
      patch,
      filled,
      keep,
      drop,
      "service_area_text",
      "service_area_text",
      "зона",
    );
  }

  if (keepKind === "business") {
    copyIfEmpty(
      patch,
      filled,
      keep,
      drop,
      "google_maps_url",
      "google_maps_url",
      "карты",
    );
    copyIfEmpty(
      patch,
      filled,
      keep,
      drop,
      "address_line",
      "address_line",
      "адрес",
    );
    if (
      isEmptyMergeValue(keep.address_line) &&
      !isEmptyMergeValue(drop.private_address_line)
    ) {
      patch.address_line = drop.private_address_line;
      filled.push("адрес");
    }
    if (keep.latitude == null && drop.latitude != null) {
      patch.latitude = drop.latitude;
      filled.push("координаты");
    }
    if (keep.longitude == null && drop.longitude != null) {
      patch.longitude = drop.longitude;
    }
  } else {
    copyIfEmpty(
      patch,
      filled,
      keep,
      drop,
      "private_address_line",
      "private_address_line",
      "адрес",
    );
    if (
      isEmptyMergeValue(keep.private_address_line) &&
      !isEmptyMergeValue(drop.address_line)
    ) {
      patch.private_address_line = drop.address_line;
      filled.push("адрес");
    }
  }

  // Description: enrich keep with unique donor facts (do not wipe keep text).
  const enrichedDesc = enrichMergeDescription(
    keep.description as string | null,
    drop.description as string | null,
  );
  if (enrichedDesc) {
    patch.description = enrichedDesc;
    filled.push("описание");
  }
  const keepShort = String(keep.short_description || "").trim();
  const dropShort = String(drop.short_description || "").trim();
  if (!keepShort && dropShort) {
    patch.short_description = dropShort;
    filled.push("краткое описание");
  } else if (
    keepShort &&
    dropShort &&
    dropShort.length >= keepShort.length + 40 &&
    descSimilarity(keepShort, dropShort) < NEAR_DUP_SIM
  ) {
    // Prefer a clearly richer short blurb only when keep's is thin.
    if (keepShort.length < 80) {
      patch.short_description = dropShort.slice(0, 400);
      filled.push("краткое описание");
    }
  }

  const mergedLinks = unionContactLinks(keep.contact_links, drop.contact_links);
  const keepLinks = parseContactLinks(keep.contact_links);
  if (mergedLinks.length > keepLinks.length) {
    patch.contact_links = mergedLinks;
    const added = mergedLinks
      .filter(
        (l) =>
          !keepLinks.some(
            (k) =>
              k.channel === l.channel &&
              k.value.toLowerCase() === l.value.toLowerCase(),
          ),
      )
      .map((l) => l.channel);
    filled.push(
      added.includes("tiktok")
        ? `соцсети (${[...new Set(added)].join(", ")})`
        : "соцсети",
    );
  }

  // Primary source_url: fill-empty only. Different donor URL → secondary trail.
  const keepSrc = String(keep.source_url || "").trim() || null;
  const dropSrc = String(drop.source_url || "").trim() || null;
  let secondarySourceUrl: string | null = null;
  let secondarySourceLabel: string | null = null;
  if (!keepSrc && dropSrc) {
    patch.source_url = dropSrc;
    if (isEmptyMergeValue(keep.source_kind) && !isEmptyMergeValue(drop.source_kind)) {
      patch.source_kind = drop.source_kind;
    } else if (
      isEmptyMergeValue(keep.source_type) &&
      !isEmptyMergeValue(drop.source_type)
    ) {
      patch.source_type = drop.source_type;
    }
    filled.push("источник");
  } else if (
    keepSrc &&
    dropSrc &&
    normalizeMergeSourceUrl(keepSrc) !== normalizeMergeSourceUrl(dropSrc)
  ) {
    secondarySourceUrl = dropSrc;
    secondarySourceLabel =
      String(
        dropKind === "professional"
          ? drop.display_name || drop.name || ""
          : drop.name || drop.display_name || "",
      ).trim() || "источник при слиянии";
    filled.push("второй источник");
  }

  const addThird = Math.max(0, Number(drop.third_party_mention_count ?? 0));
  const addSelf = Math.max(0, Number(drop.self_ad_mention_count ?? 0));
  if (addThird > 0 || addSelf > 0) {
    patch.third_party_mention_count =
      Math.max(0, Number(keep.third_party_mention_count ?? 0)) + addThird;
    patch.self_ad_mention_count =
      Math.max(0, Number(keep.self_ad_mention_count ?? 0)) + addSelf;
    filled.push("рекомендации");
  }

  return {
    patch,
    filled: [...new Set(filled)],
    secondarySourceUrl,
    secondarySourceLabel,
  };
}

function anyFrom(client: SupabaseClient, table: string) {
  return (client as unknown as SupabaseClient).from(table);
}

/** Point queue / recommendation rows at the keep card before the donor is deleted. */
export async function retargetCatalogMergeProvenance(
  catalog: SupabaseClient,
  input: {
    keepKind: CatalogMergeEntityKind;
    keepId: string;
    dropKind: CatalogMergeEntityKind;
    dropId: string;
  },
) {
  const now = new Date().toISOString();
  await anyFrom(catalog, "import_comment_recommendations")
    .update({
      published_entity_type: input.keepKind,
      published_entity_id: input.keepId,
      updated_at: now,
    })
    .eq("published_entity_id", input.dropId)
    .eq("published_entity_type", input.dropKind);

  await anyFrom(catalog, "import_comment_recommendations")
    .update({
      duplicate_of_entity_type: input.keepKind,
      duplicate_of_entity_id: input.keepId,
      updated_at: now,
    })
    .eq("duplicate_of_entity_id", input.dropId)
    .eq("duplicate_of_entity_type", input.dropKind);

  await anyFrom(catalog, "import_review_items")
    .update({
      published_entity_type: input.keepKind,
      published_entity_id: input.keepId,
      updated_at: now,
    })
    .eq("published_entity_id", input.dropId)
    .eq("published_entity_type", input.dropKind);

  await anyFrom(catalog, "import_review_items")
    .update({
      duplicate_of_entity_type: input.keepKind,
      duplicate_of_entity_id: input.keepId,
      updated_at: now,
    })
    .eq("duplicate_of_entity_id", input.dropId)
    .eq("duplicate_of_entity_type", input.dropKind);
}

/**
 * When keep already has source_url, store the donor URL as a community mention
 * so Admin «Источники» (and mention lists) still show it.
 */
export async function preserveSecondaryMergeSource(
  catalog: SupabaseClient,
  input: {
    keepKind: CatalogMergeEntityKind;
    keepId: string;
    sourceUrl: string;
    label?: string | null;
    dropId?: string | null;
  },
) {
  const url = input.sourceUrl.trim();
  if (!url) return;

  const mentionTable =
    input.keepKind === "professional"
      ? "professional_community_mentions"
      : "business_community_mentions";
  const fk =
    input.keepKind === "professional" ? "professional_id" : "business_id";
  const recordId = `merged-source:${normalizeMergeSourceUrl(url) || url}`;

  const { data: existing } = await anyFrom(catalog, mentionTable)
    .select("id")
    .eq(fk, input.keepId)
    .eq("source_record_id", recordId)
    .maybeSingle();
  if (existing) return;

  const { data: byUrl } = await anyFrom(catalog, mentionTable)
    .select("id")
    .eq(fk, input.keepId)
    .eq("source_url", url)
    .limit(1)
    .maybeSingle();
  if (byUrl) return;

  const label = (input.label || "источник при слиянии").slice(0, 120);
  const body: Record<string, unknown> = {
    [fk]: input.keepId,
    kind: "community_mention",
    source_channel: "import",
    source_label: label,
    source_url: url,
    source_record_id: recordId,
    // Hidden: provenance for Admin «Источники» / source reveal only —
    // must NOT appear under «Рекомендации сообщества».
    status: "hidden",
    published_at: new Date().toISOString(),
  };
  if (input.keepKind === "business") {
    body.snippet = `Источник карточки при слиянии: ${label}`.slice(0, 500);
    body.author_label = "merge";
  }
  await anyFrom(catalog, mentionTable).insert(body);
}

/** Columns needed to build baggage for businesses / professionals. */
export const CATALOG_MERGE_BAGGAGE_SELECT = {
  business:
    "id, slug, name, phone, email, website, instagram_url, telegram_url, google_maps_url, booking_url, yelp_url, city, region, state_code, address_line, postal_code, latitude, longitude, description, short_description, image_url, contact_links, source_url, source_kind, category_id, third_party_mention_count, self_ad_mention_count, status",
  professional:
    "id, slug, display_name, headline, phone, email, website, instagram_url, telegram_url, booking_url, city, region, state_code, private_address_line, postal_code, service_area_text, description, short_description, image_url, contact_links, source_url, source_type, category_id, languages, availability_text, third_party_mention_count, self_ad_mention_count, status",
} as const;

const MAX_MERGED_DESCRIPTION = 4000;
const NEAR_DUP_SIM = 0.78;

function descTokens(text: string): Set<string> {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ");
  return new Set(
    cleaned
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3),
  );
}

function descSimilarity(a: string, b: string): number {
  const ta = descTokens(a);
  const tb = descTokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

function splitDescUnits(text: string): string[] {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const units: string[] = [];
  for (const p of paras) {
    if (p.length < 120 && !p.includes("\n")) {
      units.push(p);
      continue;
    }
    if (/(^|\n)\s*[•✅✔\-–]\s*/.test(p)) {
      units.push(p);
      continue;
    }
    for (const part of p.split(/(?<=[.!?…])\s+(?=[A-ZА-ЯЁ«"])/)) {
      const t = part.trim();
      if (t) units.push(t);
    }
  }
  return units;
}

/**
 * Enrich keep narrative with unique factual bits from the donor.
 * Keep base text; append units that are not near-duplicates.
 */
export function enrichMergeDescription(
  keepRaw: string | null | undefined,
  dropRaw: string | null | undefined,
  maxChars = MAX_MERGED_DESCRIPTION,
): string | null {
  const keep = String(keepRaw || "").trim();
  const drop = String(dropRaw || "").trim();
  if (!drop) return null;
  if (!keep) return drop.slice(0, maxChars);
  if (descSimilarity(keep, drop) >= NEAR_DUP_SIM) {
    return drop.length > keep.length + 40 ? drop.slice(0, maxChars) : null;
  }
  const covered = descTokens(keep);
  const extras: string[] = [];
  for (const unit of splitDescUnits(drop)) {
    if (unit.length < 24) continue;
    const ut = descTokens(unit);
    if (!ut.size) continue;
    let hit = 0;
    for (const t of ut) if (covered.has(t)) hit += 1;
    if (hit / ut.size >= 0.72) continue;
    if (descSimilarity(keep, unit) >= NEAR_DUP_SIM) continue;
    if (extras.some((e) => descSimilarity(e, unit) >= NEAR_DUP_SIM)) continue;
    extras.push(unit);
    for (const t of ut) covered.add(t);
  }
  if (!extras.length) return null;
  const merged = `${keep}\n\n${extras.join("\n\n")}`.trim();
  return merged.slice(0, maxChars);
}

function serviceTitleKey(raw: string | null | undefined): string {
  return (raw || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function addressKey(row: {
  address_line?: string | null;
  private_address_line?: string | null;
  city?: string | null;
  state_code?: string | null;
}): string {
  return [
    row.address_line || row.private_address_line || "",
    row.city || "",
    String(row.state_code || "").replace(/^US-/i, ""),
  ]
    .join("|")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}|]+/gu, " ")
    .trim();
}

function offerSlugFromTitle(title: string, salt: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${base || "offer"}-${salt.slice(0, 8)}`;
}

/**
 * Child rows that make the keep card richer: services/offers + extra offices.
 * Call before the donor is destroyed.
 */
export async function enrichCatalogMergeChildren(
  catalog: SupabaseClient,
  input: {
    keepKind: CatalogMergeEntityKind;
    keepId: string;
    dropKind: CatalogMergeEntityKind;
    dropId: string;
    keep: Record<string, unknown>;
    drop: Record<string, unknown>;
  },
): Promise<string[]> {
  const filled: string[] = [];
  const { keepKind, keepId, dropKind, dropId, keep, drop } = input;

  // —— Services / offers ——
  if (keepKind === "professional") {
    const added = await unionIntoProfessionalServices(catalog, keepId, dropKind, dropId);
    if (added > 0) filled.push(`услуги (+${added})`);
  } else if (keepKind === "business" && dropKind === "professional") {
    // biz↔biz offers are re-parented by RPC; only cross-type needs a copy.
    const added = await copyProfessionalServicesToBusinessOffers(
      catalog,
      keepId,
      dropId,
    );
    if (added > 0) filled.push(`услуги (+${added})`);
  }

  // Directory titles often ARE the service list («переводчик, редактор…»).
  const seeded = await seedOffersFromDirectoryTitles(catalog, {
    keepKind,
    keepId,
    keep,
    drop,
    dropKind,
  });
  if (seeded > 0) filled.push(`услуги из названий (+${seeded})`);

  // —— Extra street / area ——
  if (keepKind === "business") {
    const locAdded = await unionBusinessLocationsFromDonor(
      catalog,
      keepId,
      dropKind,
      dropId,
      keep,
      drop,
    );
    if (locAdded > 0) filled.push(`адрес (+${locAdded})`);
  } else {
    const keepAddr = String(keep.private_address_line || "").trim();
    const dropAddr = String(
      drop.private_address_line || drop.address_line || "",
    ).trim();
    if (
      keepAddr &&
      dropAddr &&
      addressKey({ private_address_line: keepAddr, city: keep.city as string }) !==
        addressKey({
          private_address_line: dropAddr,
          city: (drop.city as string) || null,
        })
    ) {
      // Secondary office → service area text (single private_address column).
      const area = String(keep.service_area_text || "").trim();
      if (!area) {
        // Will be applied via caller patch if we return a hint — do it here.
        await anyFrom(catalog, "professionals")
          .update({
            service_area_text: dropAddr.slice(0, 400),
            updated_at: new Date().toISOString(),
          })
          .eq("id", keepId);
        filled.push("зона / доп. адрес");
      } else if (!area.toLowerCase().includes(dropAddr.toLowerCase().slice(0, 24))) {
        await anyFrom(catalog, "professionals")
          .update({
            service_area_text: `${area}; ${dropAddr}`.slice(0, 400),
            updated_at: new Date().toISOString(),
          })
          .eq("id", keepId);
        filled.push("зона / доп. адрес");
      }
    }
  }

  return filled;
}

async function unionIntoProfessionalServices(
  catalog: SupabaseClient,
  keepId: string,
  dropKind: CatalogMergeEntityKind,
  dropId: string,
): Promise<number> {
  const { data: existingRows } = await anyFrom(catalog, "professional_services")
    .select("title, sort_order")
    .eq("professional_id", keepId);
  const existing = (existingRows ?? []) as Array<{
    title: string | null;
    sort_order: number | null;
  }>;
  const taken = new Set(existing.map((r) => serviceTitleKey(r.title)));
  let nextSort = existing.reduce(
    (m, r) => Math.max(m, Number(r.sort_order ?? 0)),
    0,
  );

  type OfferLike = {
    title?: string | null;
    description?: string | null;
    short_description?: string | null;
    price_mode?: string | null;
    price_amount?: number | null;
    price_min?: number | null;
    price_max?: number | null;
    currency?: string | null;
    price_unit?: string | null;
    duration_minutes?: number | null;
    offer_kind?: string | null;
  };

  let donors: OfferLike[] = [];
  if (dropKind === "professional") {
    const { data } = await anyFrom(catalog, "professional_services")
      .select(
        "title, description, price_mode, price_amount, price_min, price_max, currency, price_unit, duration_minutes, offer_kind",
      )
      .eq("professional_id", dropId)
      .eq("is_active", true)
      .limit(80);
    donors = (data ?? []) as OfferLike[];
  } else {
    const { data } = await anyFrom(catalog, "business_offers")
      .select(
        "title, description, short_description, price_mode, price_amount, price_min, price_max, currency, price_unit",
      )
      .eq("business_id", dropId)
      .in("status", ["active", "draft"])
      .limit(80);
    donors = (data ?? []) as OfferLike[];
  }

  let added = 0;
  for (const offer of donors) {
    const title = String(offer.title || "").trim();
    const key = serviceTitleKey(title);
    if (!key || taken.has(key)) continue;
    taken.add(key);
    nextSort += 1;
    const priceMode = ["fixed", "from", "range", "free", "contact"].includes(
      String(offer.price_mode || ""),
    )
      ? offer.price_mode
      : "contact";
    const { error } = await anyFrom(catalog, "professional_services").insert({
      professional_id: keepId,
      title: title.slice(0, 160),
      description:
        String(offer.description || offer.short_description || "").trim().slice(
          0,
          2000,
        ) || null,
      offer_kind: offer.offer_kind === "hire" ? "hire" : "service",
      price_mode: priceMode,
      price_amount: offer.price_amount ?? null,
      price_min: offer.price_min ?? null,
      price_max: offer.price_max ?? null,
      currency: offer.currency || "USD",
      price_unit: offer.price_unit ?? null,
      duration_minutes: offer.duration_minutes ?? null,
      is_active: true,
      sort_order: nextSort,
    });
    if (!error) added += 1;
  }
  return added;
}

async function copyProfessionalServicesToBusinessOffers(
  catalog: SupabaseClient,
  keepBusinessId: string,
  dropProfessionalId: string,
): Promise<number> {
  const { data: existingRows } = await anyFrom(catalog, "business_offers")
    .select("title")
    .eq("business_id", keepBusinessId);
  const taken = new Set(
    ((existingRows ?? []) as Array<{ title: string | null }>).map((r) =>
      serviceTitleKey(r.title),
    ),
  );
  const { data: donors } = await anyFrom(catalog, "professional_services")
    .select(
      "title, description, price_mode, price_amount, price_min, price_max, currency, price_unit",
    )
    .eq("professional_id", dropProfessionalId)
    .eq("is_active", true)
    .limit(80);

  let added = 0;
  for (const offer of (donors ?? []) as Array<Record<string, unknown>>) {
    const title = String(offer.title || "").trim();
    const key = serviceTitleKey(title);
    if (!key || taken.has(key)) continue;
    taken.add(key);
    const salt = cryptoRandom();
    const priceModeRaw = String(offer.price_mode || "contact");
    const priceMode = ["fixed", "from", "range", "free", "contact", "on_request"].includes(
      priceModeRaw,
    )
      ? priceModeRaw === "contact"
        ? "contact"
        : priceModeRaw
      : "contact";
    const { error } = await anyFrom(catalog, "business_offers").insert({
      business_id: keepBusinessId,
      offer_type: "service",
      title: title.slice(0, 160),
      slug: offerSlugFromTitle(title, salt),
      short_description: null,
      description:
        String(offer.description || "").trim().slice(0, 2000) || null,
      status: "active",
      visibility: "public",
      price_mode: priceMode,
      price_amount: offer.price_amount ?? null,
      price_min: offer.price_min ?? null,
      price_max: offer.price_max ?? null,
      currency: offer.currency || "USD",
      price_unit: offer.price_unit ?? null,
    });
    if (!error) added += 1;
  }
  return added;
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Profession / craft tokens that open a new service clause in directory titles. */
const ROLE_START_RE =
  /(?:^|[\s,;/|])((?:репетитор|переводчик|писател\p{L}*|редактор|учитель|преподаватель|тьютор|tutor|translator|writer|editor|юрист|адвокат|нотариус|бухгалтер|массажист\p{L}*|косметолог|психолог|психотерапевт|няня|водитель|повар|фотограф|дизайнер|программист|разработчик|риелтор|агент|мастер|стилист|бровист|лэшмейкер|маникюр\p{L}*|педикюр\p{L}*|тренер|коуч|консультант|врач|стоматолог|хирург|медсестр\p{L}*)\b)/iu;

/**
 * Split a directory-style title into service names.
 * «Переводчик, писатель контента, редактор» → 3 services.
 * «Репетитор английского, русского, украинского Писатель, редактор» →
 * репетитор… + писатель + редактор.
 */
export function splitDirectoryRoleTitle(name: string | null | undefined): string[] {
  const raw = String(name || "")
    .replace(/\s+онлайн\s*$/iu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return [];

  // Insert commas before mid-string role words that lack a separator.
  let marked = raw;
  marked = marked.replace(
    /([^\s,;/|])\s+((?:репетитор|переводчик|писател\p{L}*|редактор|учитель|преподаватель|тьютор|юрист|адвокат|массажист\p{L}*|косметолог|психолог|няня|водитель|повар|фотограф|дизайнер|программист|риелтор|мастер|стилист|тренер|консультант|врач)\b)/giu,
    "$1, $2",
  );

  const chunks = marked
    .split(/\s*[,;/|]\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);

  const out: string[] = [];
  let buf = "";
  for (const chunk of chunks) {
    const startsRole = ROLE_START_RE.test(` ${chunk}`);
    if (!buf || startsRole) {
      if (buf) out.push(buf);
      buf = chunk;
    } else {
      buf = `${buf}, ${chunk}`;
    }
  }
  if (buf) out.push(buf);

  return out
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter((t) => t.length >= 3 && t.length <= 120)
    .slice(0, 12);
}

async function seedOffersFromDirectoryTitles(
  catalog: SupabaseClient,
  input: {
    keepKind: CatalogMergeEntityKind;
    keepId: string;
    keep: Record<string, unknown>;
    drop: Record<string, unknown>;
    dropKind: CatalogMergeEntityKind;
  },
): Promise<number> {
  const titles = [
    ...splitDirectoryRoleTitle(
      String(
        input.keep.name || input.keep.display_name || input.keep.headline || "",
      ),
    ),
    ...splitDirectoryRoleTitle(
      String(
        input.drop.name || input.drop.display_name || input.drop.headline || "",
      ),
    ),
  ];
  if (!titles.length) return 0;

  if (input.keepKind === "professional") {
    const { data: existingRows } = await anyFrom(catalog, "professional_services")
      .select("title, sort_order")
      .eq("professional_id", input.keepId);
    const existing = (existingRows ?? []) as Array<{
      title: string | null;
      sort_order: number | null;
    }>;
    const taken = new Set(existing.map((r) => serviceTitleKey(r.title)));
    // If the card already has a real curated list, only add missing titles.
    let nextSort = existing.reduce(
      (m, r) => Math.max(m, Number(r.sort_order ?? 0)),
      0,
    );
    let added = 0;
    for (const title of titles) {
      const key = serviceTitleKey(title);
      if (!key || taken.has(key)) continue;
      // Skip near-prefix dupes («переводчик» vs «переводчик онлайн»).
      if ([...taken].some((t) => t.startsWith(key) || key.startsWith(t))) continue;
      taken.add(key);
      nextSort += 1;
      const { error } = await anyFrom(catalog, "professional_services").insert({
        professional_id: input.keepId,
        title: title.slice(0, 160),
        description: null,
        offer_kind: "service",
        price_mode: "contact",
        currency: "USD",
        is_active: true,
        sort_order: nextSort,
      });
      if (!error) added += 1;
    }
    return added;
  }

  const { data: existingRows } = await anyFrom(catalog, "business_offers")
    .select("title")
    .eq("business_id", input.keepId);
  const taken = new Set(
    ((existingRows ?? []) as Array<{ title: string | null }>).map((r) =>
      serviceTitleKey(r.title),
    ),
  );
  let added = 0;
  for (const title of titles) {
    const key = serviceTitleKey(title);
    if (!key || taken.has(key)) continue;
    if ([...taken].some((t) => t.startsWith(key) || key.startsWith(t))) continue;
    taken.add(key);
    const salt = cryptoRandom();
    const { error } = await anyFrom(catalog, "business_offers").insert({
      business_id: input.keepId,
      offer_type: "service",
      title: title.slice(0, 160),
      slug: offerSlugFromTitle(title, salt),
      short_description: null,
      description: null,
      status: "active",
      visibility: "public",
      price_mode: "contact",
      currency: "USD",
    });
    if (!error) added += 1;
  }
  return added;
}

async function unionBusinessLocationsFromDonor(
  catalog: SupabaseClient,
  keepId: string,
  dropKind: CatalogMergeEntityKind,
  dropId: string,
  keep: Record<string, unknown>,
  drop: Record<string, unknown>,
): Promise<number> {
  const { data: existingRows } = await anyFrom(catalog, "business_locations")
    .select("id, address_line, city, state_code, sort_order, status, is_primary")
    .eq("business_id", keepId)
    .neq("status", "archived");
  const existing = (existingRows ?? []) as Array<{
    address_line: string | null;
    city: string | null;
    state_code: string | null;
    sort_order: number | null;
  }>;
  const taken = new Set(existing.map((r) => addressKey(r)));
  // Primary card street counts as taken.
  const keepStreet = String(keep.address_line || "").trim();
  if (keepStreet) {
    taken.add(
      addressKey({
        address_line: keepStreet,
        city: keep.city as string,
        state_code: keep.state_code as string,
      }),
    );
  }
  let sort = existing.reduce(
    (m, r) => Math.max(m, Number(r.sort_order ?? 0)),
    0,
  );
  let added = 0;

  const candidates: Array<{
    address_line: string;
    city: string | null;
    state_code: string | null;
    postal_code: string | null;
  }> = [];

  if (dropKind === "business") {
    const { data: locs } = await anyFrom(catalog, "business_locations")
      .select("address_line, city, state_code, postal_code, status")
      .eq("business_id", dropId)
      .neq("status", "archived")
      .limit(20);
    for (const loc of (locs ?? []) as Array<Record<string, unknown>>) {
      const street = String(loc.address_line || "").trim();
      if (!street) continue;
      candidates.push({
        address_line: street,
        city: (loc.city as string) || null,
        state_code: (loc.state_code as string) || null,
        postal_code: (loc.postal_code as string) || null,
      });
    }
    // Extra office only when keep already has a street — otherwise fill-empty
    // takes drop.address_line as the primary card address.
    const dropStreet = String(drop.address_line || "").trim();
    if (dropStreet && keepStreet) {
      candidates.push({
        address_line: dropStreet,
        city: (drop.city as string) || null,
        state_code: (drop.state_code as string) || null,
        postal_code: (drop.postal_code as string) || null,
      });
    }
  } else {
    const dropStreet = String(
      drop.private_address_line || drop.address_line || "",
    ).trim();
    if (dropStreet && keepStreet) {
      candidates.push({
        address_line: dropStreet,
        city: (drop.city as string) || null,
        state_code: (drop.state_code as string) || null,
        postal_code: (drop.postal_code as string) || null,
      });
    }
  }

  for (const cand of candidates) {
    const key = addressKey(cand);
    if (!key || taken.has(key)) continue;
    taken.add(key);
    sort += 1;
    const { error } = await anyFrom(catalog, "business_locations").insert({
      business_id: keepId,
      address_line: cand.address_line.slice(0, 240),
      city: cand.city,
      state_code: cand.state_code,
      postal_code: cand.postal_code,
      is_primary: false,
      sort_order: sort,
      status: "published",
      source: "merge",
    });
    if (!error) added += 1;
  }
  return added;
}
