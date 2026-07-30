/**
 * Collapse repeated queue rows into one card.
 *
 * A channel reposts the same ad dozens of times, so the queue ends up with
 * dozens of rows that are the same advertiser. Marking them «дубль» leaves the
 * moderator with the same wall of cards, so instead we merge: the strongest row
 * survives, every list field is unioned into it (services, contacts, media) and
 * the weak rows close as duplicates pointing at the survivor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isJunkImportTitle } from "@/lib/import-review/display-name";
import type { QueuePromotion } from "@/types/promotion";
import type { QueueUpdate } from "@/types/update";
import type { Database } from "@/types/database";
import type { ImportReviewStatus } from "@/types/import-review";

type Client = SupabaseClient<Database>;

function untyped(client: Client) {
  return client as unknown as SupabaseClient<any>;
}

export type MergeableQueueItem = {
  id: string;
  created_at: string;
  review_status: string;
  entity_type: string | null;
  target_collection: string | null;
  category: string | null;
  subcategory: string | null;
  title: string | null;
  business_name: string | null;
  person_name: string | null;
  description: string | null;
  source_text: string | null;
  source_url: string | null;
  source_message_ids: number[] | null;
  source_media: unknown[] | null;
  services: string[] | null;
  payment_methods: string[] | null;
  promotions: QueuePromotion[] | null;
  updates: QueueUpdate[] | null;
  phone: string[] | null;
  whatsapp: string[] | null;
  instagram: string[] | null;
  website: string[] | null;
  email: string[] | null;
  telegram_username: string | null;
  telegram_user_id: string | null;
  city: string | null;
  state: string | null;
  address_line: string | null;
  postal_code: string | null;
  county_geoid: string | null;
  location_source: string | null;
  location_confidence: string | null;
  price: number | null;
  currency: string | null;
  photos_count: number | null;
  preview_image_url: string | null;
  occurrence_count: number | null;
  first_seen: string | null;
  last_seen: string | null;
  recurring_cluster_id: string | null;
  review_notes: string | null;
};

/**
 * Whole row: the queue table grows columns faster than the deployed schema
 * catches up, and a select list naming a not-yet-migrated column fails the
 * whole query. Fields missing from the row are simply never merged.
 */
export const MERGE_SELECT = "*";

const OPEN_STATUSES = ["pending", "in_review", "needs_more_info", "ready_to_publish"];

/** PostgREST puts `in` filters in the URL — a popular ad has 200 copies. */
function chunk(ids: string[], size = 40): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((v) => String(v || "").trim()).filter(Boolean)
    : [];
}

function textLength(value: string | null | undefined): number {
  return (value || "").trim().length;
}

/**
 * How complete a row is. Contacts and address weigh most: they are what a
 * moderator cannot recover from another copy of the same text.
 */
export function queueItemStrength(item: MergeableQueueItem): number {
  let score = 0;
  score += list(item.phone).length ? 3 : 0;
  score += list(item.website).length ? 3 : 0;
  score += list(item.instagram).length ? 2 : 0;
  score += list(item.email).length ? 2 : 0;
  score += item.telegram_username ? 1 : 0;
  score += textLength(item.address_line) ? 3 : 0;
  score += item.postal_code ? 2 : 0;
  score += item.city ? 1 : 0;
  score += item.county_geoid ? 2 : 0;
  score += Math.min(list(item.services).length, 5);
  score += Math.min(Math.floor(textLength(item.description) / 200), 3);
  score += item.preview_image_url ? 1 : 0;
  score += (item.photos_count ?? 0) > 0 ? 1 : 0;
  // Copies of one ad often carry different names, from a real brand to
  // «Связаться». The card that keeps a usable name should win.
  const name = item.business_name || item.person_name || item.title;
  score += name && !isJunkImportTitle(name) ? 3 : 0;
  return score;
}

/** Strongest first; equal strength — the freshest repost wins. */
export function sortByStrength(items: MergeableQueueItem[]): MergeableQueueItem[] {
  return [...items].sort((a, b) => {
    const diff = queueItemStrength(b) - queueItemStrength(a);
    if (diff !== 0) return diff;
    const time = Date.parse(b.created_at) - Date.parse(a.created_at);
    if (time !== 0) return time;
    return a.id.localeCompare(b.id);
  });
}

function uniqueStrings(...groups: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const value of list(group)) {
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

function uniqueByKey<T>(rows: T[][], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const group of rows) {
    for (const row of group ?? []) {
      const id = key(row);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(row);
    }
  }
  return out;
}

function earliest(values: (string | null)[]): string | null {
  const times = values.filter(Boolean) as string[];
  return times.length
    ? times.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b))
    : null;
}

function latest(values: (string | null)[]): string | null {
  const times = values.filter(Boolean) as string[];
  return times.length
    ? times.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b))
    : null;
}

export type MergePatch = Record<string, unknown>;

/**
 * Build the surviving row: scalars stay as they are unless empty, text fields
 * take the fullest version, lists take the union.
 */
export function buildMergePatch(
  strong: MergeableQueueItem,
  weak: MergeableQueueItem[],
): { patch: MergePatch; changed: string[] } {
  const all = [strong, ...weak];
  const patch: MergePatch = {};

  const fillIfEmpty: (keyof MergeableQueueItem)[] = [
    "business_name",
    "person_name",
    "category",
    "subcategory",
    "entity_type",
    "target_collection",
    "city",
    "state",
    "address_line",
    "postal_code",
    "county_geoid",
    "location_source",
    "location_confidence",
    "telegram_username",
    "telegram_user_id",
    "preview_image_url",
    "currency",
  ];
  for (const field of fillIfEmpty) {
    if (String(strong[field] ?? "").trim()) continue;
    const donor = weak.find((item) => String(item[field] ?? "").trim());
    if (donor) patch[field] = donor[field];
  }

  if (strong.price == null) {
    const donor = weak.find((item) => item.price != null);
    if (donor) patch.price = donor.price;
  }

  // «Связаться» is not a name: take a real one from a copy if there is one.
  for (const field of ["business_name", "title"] as const) {
    if (!isJunkImportTitle(String(patch[field] ?? strong[field] ?? ""))) continue;
    const donor = weak.find((item) => !isJunkImportTitle(item[field]));
    if (donor) patch[field] = donor[field];
  }

  for (const field of ["description", "source_text"] as const) {
    const fullest = all.reduce((best, item) =>
      textLength(item[field]) > textLength(best[field]) ? item : best,
    );
    if (textLength(fullest[field]) > textLength(strong[field])) {
      patch[field] = fullest[field];
    }
  }

  const listFields: (keyof MergeableQueueItem)[] = [
    "services",
    "payment_methods",
    "phone",
    "whatsapp",
    "instagram",
    "website",
    "email",
  ];
  for (const field of listFields) {
    const merged = uniqueStrings(...all.map((item) => item[field]));
    if (merged.length > list(strong[field]).length) patch[field] = merged;
  }

  const promotions = uniqueByKey(
    all.map((item) => (item.promotions ?? []) as QueuePromotion[]),
    (row) => String(row?.title ?? "").trim().toLowerCase(),
  );
  if (promotions.length > (strong.promotions ?? []).length) {
    patch.promotions = promotions;
  }

  const updates = uniqueByKey(
    all.map((item) => (item.updates ?? []) as QueueUpdate[]),
    (row) => String(row?.title ?? "").trim().toLowerCase(),
  );
  if (updates.length > (strong.updates ?? []).length) patch.updates = updates;

  const media = uniqueByKey(
    all.map((item) => (item.source_media ?? []) as Record<string, unknown>[]),
    (row) =>
      String(
        row?.telegram_message_id ??
          row?.storage_path ??
          row?.original_filename ??
          "",
      ),
  );
  if (media.length > (strong.source_media ?? []).length) {
    patch.source_media = media;
  }

  const messageIds = Array.from(
    new Set(all.flatMap((item) => item.source_message_ids ?? [])),
  ).sort((a, b) => a - b);
  if (messageIds.length > (strong.source_message_ids ?? []).length) {
    patch.source_message_ids = messageIds;
  }

  const photos = Math.max(...all.map((item) => item.photos_count ?? 0));
  if (photos > (strong.photos_count ?? 0)) patch.photos_count = photos;

  // The card now stands for every repost we folded into it.
  patch.occurrence_count = all.reduce(
    (sum, item) => sum + Math.max(item.occurrence_count ?? 1, 1),
    0,
  );

  const first = earliest(all.map((item) => item.first_seen));
  if (first && first !== strong.first_seen) patch.first_seen = first;
  const last = latest(all.map((item) => item.last_seen));
  if (last && last !== strong.last_seen) patch.last_seen = last;

  patch.review_notes = `${strong.review_notes ?? ""} [merged_copies:${weak.length}]`.trim();
  patch.updated_at = new Date().toISOString();

  const changed = Object.keys(patch).filter(
    (key) => !["updated_at", "review_notes", "occurrence_count"].includes(key),
  );
  return { patch, changed };
}

/** Same advertiser and same kind of card — safe to fold together. */
export function sameKind(a: MergeableQueueItem, b: MergeableQueueItem): boolean {
  const type = (value: string | null) => (value || "").toLowerCase();
  return (
    type(a.entity_type) === type(b.entity_type) &&
    type(a.target_collection) === type(b.target_collection)
  );
}

export type MergeResult = {
  survivorId: string;
  survivorTitle: string | null;
  mergedCount: number;
  changed: string[];
};

/**
 * Fold `ids` into their strongest row. Weak rows close as duplicates of the
 * survivor, so nothing is deleted and the merge stays reversible.
 */
export async function mergeQueueItems(
  client: Client,
  ids: string[],
): Promise<MergeResult | null> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length < 2) return null;

  const rows: MergeableQueueItem[] = [];
  for (const batch of chunk(unique)) {
    const { data, error } = await client
      .from("import_review_items")
      .select(MERGE_SELECT)
      .in("id", batch);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as MergeableQueueItem[]));
  }
  const open = rows.filter((row) => OPEN_STATUSES.includes(row.review_status));
  if (open.length < 2) return null;

  const [strong, ...weak] = sortByStrength(open);
  const { patch, changed } = buildMergePatch(strong, weak);

  const { error: updateError } = await untyped(client)
    .from("import_review_items")
    .update(patch)
    .eq("id", strong.id);
  if (updateError) throw new Error(updateError.message);

  for (const batch of chunk(weak.map((item) => item.id))) {
    const { error: closeError } = await untyped(client)
      .from("import_review_items")
      .update({
        review_status: "duplicate",
        duplicate_of_item_id: strong.id,
        review_notes: `Слито в ${strong.id}`,
        updated_at: new Date().toISOString(),
      })
      .in("id", batch);
    if (closeError) throw new Error(closeError.message);
  }

  return {
    survivorId: strong.id,
    survivorTitle: strong.business_name || strong.title || strong.person_name,
    mergedCount: weak.length,
    changed,
  };
}

/**
 * Open queue rows that are the same advertiser as `item`: the repost cluster
 * plus rows sharing a Telegram account or a phone number.
 */
export async function findQueueTwins(
  client: Client,
  item: MergeableQueueItem,
): Promise<{ row: MergeableQueueItem; reason: string }[]> {
  const found = new Map<string, { row: MergeableQueueItem; reason: string }>();

  const collect = async (
    reason: string,
    build: () => unknown,
    opts: { anyKind?: boolean } = {},
  ) => {
    const { data } = (await build()) as { data: unknown };
    for (const raw of (data ?? []) as MergeableQueueItem[]) {
      if (raw.id === item.id || found.has(raw.id)) continue;
      // Shared contacts can belong to a business and a listing at once, so
      // those merge only within one kind. A repost is one ad by definition,
      // even when copies were classified differently.
      if (!opts.anyKind && !sameKind(raw, item)) continue;
      found.set(raw.id, { row: raw, reason });
    }
  };

  const base = () =>
    client
      .from("import_review_items")
      .select(MERGE_SELECT)
      .in("review_status", OPEN_STATUSES as ImportReviewStatus[])
      .neq("id", item.id)
      .limit(200);

  if (item.recurring_cluster_id) {
    await collect(
      "повтор объявления",
      () => base().eq("recurring_cluster_id", item.recurring_cluster_id!),
      { anyKind: true },
    );
  }
  // telegram_user_id is the collecting channel for most rows (one id covers
  // half the queue), so it identifies nothing. The @username does.
  if (item.telegram_username) {
    await collect("тот же telegram-ник", () =>
      base().eq("telegram_username", item.telegram_username!),
    );
  }
  const phones = list(item.phone);
  if (phones.length) {
    await collect("тот же телефон", () => base().overlaps("phone", phones));
  }

  return [...found.values()];
}
