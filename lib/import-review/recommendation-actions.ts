"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import { mergeLocationWithGroupFallback } from "@/lib/geo/source-group-location";
import { inferLocationPrecision } from "@/lib/business/location-precision";
import {
  resolveSourceKind,
  sourceTypeFromKind,
} from "@/lib/business/presence";
import {
  businessSlugFromGuess,
  professionalSlugFromGuess,
} from "@/lib/import-review/recommendation-category";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";
import {
  findRecommendationExactDuplicate,
  findRecommendationLiveDuplicate,
  parseRecommendationNotes,
  type RecommendationDuplicateMatch,
} from "@/lib/import-review/recommendation-duplicate";
import {
  addMissingProfessionalServices,
  offersFromAdTexts,
  type ImportedOffer,
} from "@/lib/professional/import-services";
import {
  yellowPagesEntityKind,
  yellowPagesToBusinessPreview,
  yellowPagesToProfessionalPreview,
  yellowPagesToServicePreview,
  resolveYellowPagesCity,
} from "@/lib/import-review/yellow-pages-preview";

type ActionResult =
  | {
      ok: true;
      message?: string;
      publishedEntityType?: string;
      publishedEntityId?: string;
      publicPath?: string;
      duplicateCandidate?: RecommendationDuplicateMatch;
    }
  | {
      ok: false;
      message: string;
      duplicateCandidate?: RecommendationDuplicateMatch;
    };

function fail(
  message: string,
  duplicateCandidate?: RecommendationDuplicateMatch,
): ActionResult {
  return { ok: false, message, duplicateCandidate };
}

function ok(
  message?: string,
  extra?: {
    publishedEntityType?: string;
    publishedEntityId?: string;
    publicPath?: string;
    duplicateCandidate?: RecommendationDuplicateMatch;
  },
): ActionResult {
  return { ok: true, message, ...extra };
}

function untyped(client: SupabaseClient) {
  return client as unknown as SupabaseClient;
}

function recommendationsTable(client: SupabaseClient) {
  return untyped(client).from("import_comment_recommendations");
}

async function requireAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, user: null, error: fail("Нужно войти в аккаунт.") };
  }
  const isAdmin = await userIsAdmin(supabase);
  if (!isAdmin) {
    return { supabase, user, error: fail("Только для администраторов.") };
  }
  return { supabase, user, error: null as null };
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const stamp = Date.now().toString(36).slice(-4);
  return `${base || "item"}-${stamp}`;
}

function firstPhone(phones: string[]): string | null {
  for (const p of phones) {
    const digits = p.replace(/\D/g, "");
    if (digits.length >= 10) return p.trim();
  }
  return null;
}

function igUrl(handles: string[]): string | null {
  const h = handles.map((x) => x.trim().replace(/^@/, "")).find(Boolean);
  return h ? `https://www.instagram.com/${h}` : null;
}

function plainWebsite(websites: string[]): string | null {
  for (const w of websites) {
    const s = w.trim();
    if (!/^https?:\/\//i.test(s)) continue;
    if (/instagram\.com|facebook\.com|t\.me\/|telegram\.me|wa\.me/i.test(s)) {
      continue;
    }
    return s.split("?")[0]!.slice(0, 300);
  }
  return null;
}

function tgUrl(websites: string[]): string | null {
  for (const w of websites) {
    const m = w.match(/(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{4,32})/i);
    if (m?.[1] && !/^\d+$/.test(m[1]) && !["c", "s"].includes(m[1].toLowerCase())) {
      return `https://t.me/${m[1]}`;
    }
  }
  return null;
}

function descriptionFrom(item: CommentRecommendation): string | null {
  const parts = (item.comment_texts || []).filter(Boolean).slice(0, 3);
  if (parts.length) return parts.join("\n\n").slice(0, 4000);
  const snip = (item.request_snippets || []).find(Boolean);
  return snip?.slice(0, 4000) || null;
}

async function lookupCategoryId(
  supabase: SupabaseClient,
  domain: "professional" | "business",
  slug: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("categories")
    .select("id")
    .eq("domain", domain)
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  return data?.id ?? null;
}

function resolveLocation(item: CommentRecommendation) {
  const group =
    item.source_groups?.[0] ||
    item.directory_source ||
    item.source_channel;
  const inferredCity = resolveYellowPagesCity(item);
  return mergeLocationWithGroupFallback({
    city: inferredCity || item.city,
    region: null,
    sourceGroup: group,
    source: item.source_channel,
  });
}

async function loadRecommendation(
  supabase: SupabaseClient,
  id: string,
): Promise<CommentRecommendation | null> {
  const { data, error } = await recommendationsTable(supabase)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as CommentRecommendation;
  return {
    ...row,
    target_bucket: row.target_bucket || "unclassified",
    directory_source: row.directory_source ?? null,
    third_party_mention_count: Number(row.third_party_mention_count ?? 0),
    self_ad_mention_count: Number(row.self_ad_mention_count ?? 0),
    mention_count: Number(row.mention_count ?? 1),
  };
}

function revalidateRecommendationPaths(item: CommentRecommendation) {
  revalidatePath("/admin/recommendations");
  revalidatePath("/admin/telegram-groups");
  revalidatePath("/admin/directories");
  if (item.directory_source) {
    revalidatePath(`/admin/telegram-groups`);
    revalidatePath(`/admin/directories`);
  }
  revalidatePath("/admin/businesses");
  revalidatePath("/admin/events");
  revalidatePath("/admin/review/inbox");
  revalidatePath(`/admin/review/${encodeURIComponent(`recommendation:${item.id}`)}`);
  revalidatePath(
    `/admin/review/${encodeURIComponent(`event_verification:${item.id}`)}`,
  );
  revalidatePath("/search");
  revalidatePath("/");
  revalidatePath("/events");
}

export async function rejectCommentRecommendationAction(input: {
  id: string;
}): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const item = await loadRecommendation(supabase, input.id);
  if (!item) return fail("Запись не найдена.");
  if (item.status === "approved" || item.status === "merged") {
    return fail("Уже закрыто — отклонить нельзя.");
  }

  const { error: updError } = await recommendationsTable(supabase)
    .update({
      status: "rejected",
      duplicate_of_entity_type: null,
      duplicate_of_entity_id: null,
      duplicate_confidence: null,
      duplicate_reason: null,
    })
    .eq("id", input.id);
  if (updError) return fail(updError.message || "Не удалось отклонить.");

  revalidateRecommendationPaths(item);
  return ok("Отклонено.");
}

export async function markRecommendationSuspectedDuplicateAction(input: {
  id: string;
  entityType?: "professional" | "business";
  entityId?: string;
  reason?: string;
}): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const item = await loadRecommendation(supabase, input.id);
  if (!item) return fail("Запись не найдена.");
  if (item.status === "approved" || item.status === "merged") {
    return fail("Уже опубликовано/слито.");
  }

  let match: RecommendationDuplicateMatch | null = null;
  if (input.entityType && input.entityId) {
    const table =
      input.entityType === "professional" ? "professionals" : "businesses";
    const { data } = await untyped(supabase)
      .from(table)
      .select(
        input.entityType === "professional"
          ? "id, slug, display_name"
          : "id, slug, name",
      )
      .eq("id", input.entityId)
      .maybeSingle();
    if (!data) return fail("Целевая карточка не найдена.");
    const row = data as {
      id: string;
      slug: string;
      display_name?: string;
      name?: string;
    };
    match = {
      entityType: input.entityType,
      entityId: row.id,
      slug: row.slug,
      name: row.display_name || row.name || "Карточка",
      reason: input.reason?.trim() || "manual",
      strength: "weak",
    };
  } else {
    match = await findRecommendationLiveDuplicate(supabase, item);
  }
  if (!match) {
    return fail("Не нашли живую карточку для подозрения на дубликат.");
  }

  const { error: updError } = await recommendationsTable(supabase)
    .update({
      status: "suspected_duplicate",
      duplicate_of_entity_type: match.entityType,
      duplicate_of_entity_id: match.entityId,
      duplicate_confidence: "suspected",
      duplicate_reason: match.reason.slice(0, 240),
    })
    .eq("id", input.id);
  if (updError) return fail(updError.message || "Не удалось пометить.");

  revalidateRecommendationPaths(item);
  return ok(`Подозрение на дубликат: ${match.name}`, {
    publishedEntityType: match.entityType,
    publishedEntityId: match.entityId,
    publicPath:
      match.entityType === "professional"
        ? `/professional/${match.slug}`
        : `/business/${match.slug}`,
    duplicateCandidate: match,
  });
}

export async function clearRecommendationDuplicateSuspicionAction(input: {
  id: string;
}): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const item = await loadRecommendation(supabase, input.id);
  if (!item) return fail("Запись не найдена.");
  if (item.status !== "suspected_duplicate") {
    return fail("Нет активного подозрения на дубликат.");
  }

  const { error: updError } = await recommendationsTable(supabase)
    .update({
      status: "pending",
      duplicate_of_entity_type: null,
      duplicate_of_entity_id: null,
      duplicate_confidence: null,
      duplicate_reason: null,
    })
    .eq("id", input.id);
  if (updError) return fail(updError.message || "Не удалось снять подозрение.");

  revalidateRecommendationPaths(item);
  return ok("Подозрение снято — снова pending.");
}

async function fillEmptyProfessionalFromRecommendation(
  supabase: SupabaseClient,
  keepId: string,
  item: CommentRecommendation,
): Promise<void> {
  const { data: row } = await untyped(supabase)
    .from("professionals")
    .select(
      "id,phone,email,website,instagram_url,city,region,state_code,private_address_line,postal_code,location_precision,source_url",
    )
    .eq("id", keepId)
    .maybeSingle();
  if (!row) return;

  const cur = row as Record<string, string | null>;
  const notes = parseRecommendationNotes(item.notes);
  const phone = firstPhone(item.phones || []);
  const website = plainWebsite(item.websites || []);
  const instagram = igUrl(item.instagram || []);
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (!cur.phone?.trim() && phone) patch.phone = phone;
  if (!cur.email?.trim() && notes.email) patch.email = notes.email;
  if (!cur.website?.trim() && website) patch.website = website;
  if (!cur.instagram_url?.trim() && instagram) patch.instagram_url = instagram;
  if (!cur.city?.trim() && item.city?.trim()) patch.city = item.city.trim();
  if (!cur.private_address_line?.trim() && notes.address) {
    patch.private_address_line = notes.address.slice(0, 200);
    patch.location_precision = "street";
  }
  if (!cur.postal_code?.trim() && notes.zip) patch.postal_code = notes.zip.slice(0, 10);
  if (!cur.source_url?.trim() && item.source_post_urls?.[0]) {
    patch.source_url = item.source_post_urls[0];
  }
  if (Object.keys(patch).length <= 1) return;
  await untyped(supabase).from("professionals").update(patch).eq("id", keepId);
}

async function fillEmptyBusinessFromRecommendation(
  supabase: SupabaseClient,
  keepId: string,
  item: CommentRecommendation,
): Promise<void> {
  const { data: row } = await supabase
    .from("businesses")
    .select("id,phone,website,instagram_url,city,address_line,source_url")
    .eq("id", keepId)
    .maybeSingle();
  if (!row) return;

  const notes = parseRecommendationNotes(item.notes);
  const phone = firstPhone(item.phones || []);
  const website = plainWebsite(item.websites || []);
  const instagram = igUrl(item.instagram || []);
  const patch: Record<string, unknown> = {};
  if (!row.phone?.trim() && phone) patch.phone = phone;
  if (!row.website?.trim() && website) patch.website = website;
  if (!row.instagram_url?.trim() && instagram) patch.instagram_url = instagram;
  if (!row.city?.trim() && item.city?.trim()) patch.city = item.city.trim();
  if (!row.address_line?.trim() && notes.address) {
    patch.address_line = notes.address.slice(0, 200);
  }
  if (!row.source_url?.trim() && item.source_post_urls?.[0]) {
    patch.source_url = item.source_post_urls[0];
  }
  if (Object.keys(patch).length === 0) return;
  await supabase.from("businesses").update(patch).eq("id", keepId);
}

function recommendationSourceChannel(
  item: CommentRecommendation,
): "facebook" | "telegram" | "import" | "other" {
  if (item.source_channel === "facebook") return "facebook";
  if (item.source_channel === "telegram") return "telegram";
  if (item.directory_source) return "import";
  return "other";
}

function mentionSnippetFromRecommendation(item: CommentRecommendation): string {
  const fromComment = (item.comment_texts || []).find((t) => t.trim().length >= 3);
  if (fromComment) return fromComment.trim().slice(0, 500);
  const fromReq = (item.request_snippets || []).find((t) => t.trim().length >= 3);
  if (fromReq) return fromReq.trim().slice(0, 500);
  return "Рекомендация сообщества";
}

async function bumpProfessionalMentionCounts(
  supabase: SupabaseClient,
  keepId: string,
  item: CommentRecommendation,
): Promise<void> {
  const { data: row } = await untyped(supabase)
    .from("professionals")
    .select("id, third_party_mention_count, self_ad_mention_count")
    .eq("id", keepId)
    .maybeSingle();
  if (!row) return;
  const cur = row as {
    third_party_mention_count: number | null;
    self_ad_mention_count: number | null;
  };
  const addThird = Math.max(0, Number(item.third_party_mention_count ?? 0));
  const addSelf = Math.max(0, Number(item.self_ad_mention_count ?? 0));
  const thirdInc = addThird > 0 ? addThird : addSelf > 0 ? 0 : 1;
  await untyped(supabase)
    .from("professionals")
    .update({
      third_party_mention_count:
        Math.max(0, Number(cur.third_party_mention_count ?? 0)) + thirdInc,
      self_ad_mention_count:
        Math.max(0, Number(cur.self_ad_mention_count ?? 0)) + addSelf,
      updated_at: new Date().toISOString(),
    })
    .eq("id", keepId);
}

async function bumpBusinessMentionCounts(
  supabase: SupabaseClient,
  keepId: string,
  item: CommentRecommendation,
): Promise<void> {
  const { data: row } = await untyped(supabase)
    .from("businesses")
    .select("id, third_party_mention_count, self_ad_mention_count")
    .eq("id", keepId)
    .maybeSingle();
  if (!row) return;
  const cur = row as {
    third_party_mention_count: number | null;
    self_ad_mention_count: number | null;
  };
  const addThird = Math.max(0, Number(item.third_party_mention_count ?? 0));
  const addSelf = Math.max(0, Number(item.self_ad_mention_count ?? 0));
  const thirdInc = addThird > 0 ? addThird : addSelf > 0 ? 0 : 1;
  await untyped(supabase)
    .from("businesses")
    .update({
      third_party_mention_count:
        Math.max(0, Number(cur.third_party_mention_count ?? 0)) + thirdInc,
      self_ad_mention_count:
        Math.max(0, Number(cur.self_ad_mention_count ?? 0)) + addSelf,
    })
    .eq("id", keepId);
}

async function insertProfessionalCommunityMention(
  supabase: SupabaseClient,
  professionalId: string,
  item: CommentRecommendation,
): Promise<void> {
  const sourceUrl = item.source_post_urls?.[0]?.trim() || null;
  const kind =
    Number(item.self_ad_mention_count ?? 0) > 0 &&
    Number(item.third_party_mention_count ?? 0) <= 0
      ? "self_ad"
      : "third_party_recommendation";
  const { data: existing } = await untyped(supabase)
    .from("professional_community_mentions")
    .select("id")
    .eq("professional_id", professionalId)
    .eq("source_record_id", item.id)
    .maybeSingle();
  if (existing) return;
  await untyped(supabase).from("professional_community_mentions").insert({
    professional_id: professionalId,
    kind,
    source_channel: recommendationSourceChannel(item),
    source_label: item.source_groups?.[0] || item.directory_source || null,
    source_url: sourceUrl,
    source_record_id: item.id,
    status: "published",
    published_at: new Date().toISOString(),
  });
}

async function insertBusinessCommunityMention(
  supabase: SupabaseClient,
  businessId: string,
  item: CommentRecommendation,
): Promise<void> {
  const sourceUrl = item.source_post_urls?.[0]?.trim() || null;
  const kind =
    Number(item.self_ad_mention_count ?? 0) > 0 &&
    Number(item.third_party_mention_count ?? 0) <= 0
      ? "community_mention"
      : "third_party_recommendation";
  const { data: existing } = await untyped(supabase)
    .from("business_community_mentions")
    .select("id")
    .eq("business_id", businessId)
    .eq("source_record_id", item.id)
    .maybeSingle();
  if (existing) return;
  await untyped(supabase).from("business_community_mentions").insert({
    business_id: businessId,
    kind,
    source_channel: recommendationSourceChannel(item),
    source_label: item.source_groups?.[0] || item.directory_source || null,
    source_url: sourceUrl,
    source_record_id: item.id,
    snippet: mentionSnippetFromRecommendation(item),
    author_label: item.recommender_names?.[0] || null,
    status: "published",
    published_at: new Date().toISOString(),
  });
}

/** Self-ads say what the person offers; third-party praise does not. */
function offersFromRecommendation(item: CommentRecommendation): ImportedOffer[] {
  const isSelfAd =
    Number(item.self_ad_mention_count ?? 0) > 0 &&
    Number(item.third_party_mention_count ?? 0) === 0;
  if (!isSelfAd) return [];
  return offersFromAdTexts([
    ...(item.request_snippets || []),
    ...(item.comment_texts || []),
  ]);
}

async function attachRecommendationToLiveEntity(
  supabase: SupabaseClient,
  entityType: "professional" | "business",
  entityId: string,
  item: CommentRecommendation,
): Promise<void> {
  if (entityType === "professional") {
    await fillEmptyProfessionalFromRecommendation(supabase, entityId, item);
    await addMissingProfessionalServices(
      supabase,
      entityId,
      offersFromRecommendation(item),
    );
    await bumpProfessionalMentionCounts(supabase, entityId, item);
    await insertProfessionalCommunityMention(supabase, entityId, item);
  } else {
    await fillEmptyBusinessFromRecommendation(supabase, entityId, item);
    await bumpBusinessMentionCounts(supabase, entityId, item);
    await insertBusinessCommunityMention(supabase, entityId, item);
  }
}

export async function confirmRecommendationMergeAction(input: {
  id: string;
  entityType?: "professional" | "business";
  entityId?: string;
}): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const item = await loadRecommendation(supabase, input.id);
  if (!item) return fail("Запись не найдена.");
  if (item.status === "merged" && item.published_entity_id) {
    return ok("Уже слито ранее.", {
      publishedEntityType: item.published_entity_type || undefined,
      publishedEntityId: item.published_entity_id,
    });
  }
  if (item.status === "approved") {
    return fail("Уже approved как новая карточка — merge недоступен.");
  }

  let entityType =
    input.entityType ||
    (item.duplicate_of_entity_type as "professional" | "business" | null);
  let entityId = input.entityId || item.duplicate_of_entity_id || null;
  let matchReason = item.duplicate_reason || null;

  if (!entityType || !entityId) {
    const match = await findRecommendationLiveDuplicate(supabase, item);
    if (!match) return fail("Нет цели для merge.");
    entityType = match.entityType;
    entityId = match.entityId;
    matchReason = match.reason;
  }

  const table = entityType === "professional" ? "professionals" : "businesses";
  const { data: keep } = await untyped(supabase)
    .from(table)
    .select(
      entityType === "professional" ? "id, slug, display_name" : "id, slug, name",
    )
    .eq("id", entityId)
    .maybeSingle();
  if (!keep) return fail("Целевая карточка не найдена.");
  const keepRow = keep as {
    id: string;
    slug: string;
    display_name?: string;
    name?: string;
  };

  await attachRecommendationToLiveEntity(supabase, entityType, entityId, item);

  const { error: updError } = await recommendationsTable(supabase)
    .update({
      status: "merged",
      published_entity_type: entityType,
      published_entity_id: entityId,
      duplicate_of_entity_type: entityType,
      duplicate_of_entity_id: entityId,
      duplicate_confidence: "confirmed",
      duplicate_reason:
        matchReason ||
        item.duplicate_reason ||
        `merged_into:${keepRow.slug}`.slice(0, 240),
    })
    .eq("id", input.id);
  if (updError) return fail(updError.message || "Не удалось сохранить merge.");

  revalidateRecommendationPaths(item);
  if (entityType === "professional") {
    revalidatePath(`/professional/${keepRow.slug}`);
  } else {
    revalidatePath(`/business/${keepRow.slug}`);
  }

  return ok(
    `Слито в ${keepRow.display_name || keepRow.name || keepRow.slug} (fill-empty + упоминания).`,
    {
      publishedEntityType: entityType,
      publishedEntityId: entityId,
      publicPath:
        entityType === "professional"
          ? `/professional/${keepRow.slug}`
          : `/business/${keepRow.slug}`,
    },
  );
}

/**
 * Exact phone/website match → auto attach (merge). Weak name → suspected only.
 * Safe to call on Workspace open.
 */
export async function autoAttachOrSuspectRecommendationAction(input: {
  id: string;
}): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const item = await loadRecommendation(supabase, input.id);
  if (!item) return fail("Запись не найдена.");
  if (item.kind === "event") return ok("Event — skip.");
  if (
    item.status === "merged" ||
    item.status === "approved" ||
    item.status === "rejected"
  ) {
    return ok("Уже закрыто.");
  }

  const exact = await findRecommendationExactDuplicate(supabase, item);
  if (exact) {
    return confirmRecommendationMergeAction({
      id: input.id,
      entityType: exact.entityType,
      entityId: exact.entityId,
    });
  }

  const weak = await findRecommendationLiveDuplicate(supabase, item, {
    includeWeak: true,
  });
  if (weak && weak.strength === "weak") {
    if (
      item.status === "suspected_duplicate" &&
      item.duplicate_of_entity_id === weak.entityId
    ) {
      return ok("Подозрение уже стоит.", {
        publishedEntityType: weak.entityType,
        publishedEntityId: weak.entityId,
        publicPath:
          weak.entityType === "professional"
            ? `/professional/${weak.slug}`
            : `/business/${weak.slug}`,
        duplicateCandidate: weak,
      });
    }
    const { error: updError } = await recommendationsTable(supabase)
      .update({
        status: "suspected_duplicate",
        duplicate_of_entity_type: weak.entityType,
        duplicate_of_entity_id: weak.entityId,
        duplicate_confidence: "suspected",
        duplicate_reason: weak.reason.slice(0, 240),
      })
      .eq("id", input.id);
    if (updError) return fail(updError.message || "Не удалось пометить.");
    revalidateRecommendationPaths(item);
    return ok(`Подозрение: ${weak.name}`, {
      publishedEntityType: weak.entityType,
      publishedEntityId: weak.entityId,
      publicPath:
        weak.entityType === "professional"
          ? `/professional/${weak.slug}`
          : `/business/${weak.slug}`,
      duplicateCandidate: weak,
    });
  }

  return ok("Совпадений нет.");
}

/** Scan pending recommendations: exact → merge; weak → suspect. */
export async function scanPendingRecommendationsForDuplicatesAction(input?: {
  limit?: number;
}): Promise<ActionResult & { scanned?: number; attached?: number; suspected?: number }> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const limit = Math.min(200, Math.max(1, input?.limit ?? 50));
  const { data, error: listError } = await recommendationsTable(supabase)
    .select("*")
    .eq("status", "pending")
    .neq("kind", "event")
    .order("mention_count", { ascending: false })
    .limit(limit);
  if (listError) return fail(listError.message || "Не удалось загрузить.");

  const rows = (data ?? []) as CommentRecommendation[];
  let attached = 0;
  let suspected = 0;
  for (const row of rows) {
    const item: CommentRecommendation = {
      ...row,
      third_party_mention_count: Number(row.third_party_mention_count ?? 0),
      self_ad_mention_count: Number(row.self_ad_mention_count ?? 0),
      mention_count: Number(row.mention_count ?? 1),
    };
    const exact = await findRecommendationExactDuplicate(supabase, item);
    if (exact) {
      const res = await confirmRecommendationMergeAction({
        id: item.id,
        entityType: exact.entityType,
        entityId: exact.entityId,
      });
      if (res.ok) attached += 1;
      continue;
    }
    const weak = await findRecommendationLiveDuplicate(supabase, item, {
      includeWeak: true,
    });
    if (weak?.strength === "weak") {
      await recommendationsTable(supabase)
        .update({
          status: "suspected_duplicate",
          duplicate_of_entity_type: weak.entityType,
          duplicate_of_entity_id: weak.entityId,
          duplicate_confidence: "suspected",
          duplicate_reason: weak.reason.slice(0, 240),
        })
        .eq("id", item.id);
      suspected += 1;
    }
  }

  revalidatePath("/admin/recommendations");
  revalidatePath("/admin/review/inbox");
  return {
    ok: true,
    message: `Проверено ${rows.length}: прикреплено ${attached}, подозрений ${suspected}.`,
    scanned: rows.length,
    attached,
    suspected,
  };
}

export async function approveCommentRecommendationAction(input: {
  id: string;
  /** Skip live-duplicate gate (admin force create). */
  force?: boolean;
}): Promise<ActionResult> {
  const { supabase, user, error } = await requireAdmin();
  if (error) return error;
  if (!user) return fail("Нужно войти в аккаунт.");

  const item = await loadRecommendation(supabase, input.id);
  if (!item) return fail("Запись не найдена.");

  if (item.kind === "event") {
    return approveEventRecommendationAction({ id: input.id });
  }

  if (item.status === "merged") {
    return fail("Уже слито в существующую карточку — approve новой недоступен.");
  }

  if (item.status === "approved" && item.published_entity_id) {
    const kind = item.published_entity_type || "business";
    const path =
      kind === "professional"
        ? `/professional/${item.published_entity_id}`
        : kind === "listing"
          ? `/services`
          : `/business`;
    return ok("Уже одобрено ранее.", {
      publishedEntityType: kind,
      publishedEntityId: item.published_entity_id,
      publicPath: path,
    });
  }

  if (!input.force) {
    const exact = await findRecommendationExactDuplicate(supabase, item);
    if (exact) {
      return confirmRecommendationMergeAction({
        id: input.id,
        entityType: exact.entityType,
        entityId: exact.entityId,
      });
    }
    const weak = await findRecommendationLiveDuplicate(supabase, item, {
      includeWeak: true,
    });
    if (weak?.strength === "weak") {
      await recommendationsTable(supabase)
        .update({
          status: "suspected_duplicate",
          duplicate_of_entity_type: weak.entityType,
          duplicate_of_entity_id: weak.entityId,
          duplicate_confidence: "suspected",
          duplicate_reason: weak.reason.slice(0, 240),
        })
        .eq("id", input.id);
      revalidateRecommendationPaths(item);
      return fail(
        `Похоже на «${weak.name}» (${weak.reason}). Подтвердите merge или снимите подозрение.`,
        weak,
      );
    }
  }

  const name = (item.display_name || "").trim();
  if (!name || name === "Без названия") {
    return fail("Нужно название.");
  }

  const phone = firstPhone(item.phones || []);
  const instagram = igUrl(item.instagram || []);
  const website = plainWebsite(item.websites || []);
  const telegram = tgUrl(item.websites || []);
  const sourceUrl = item.source_post_urls?.[0] || null;
  const notesParsed = parseRecommendationNotes(item.notes);
  const hasContact = Boolean(phone || instagram || website || telegram || sourceUrl);
  if (!hasContact) {
    return fail("Нужен хотя бы один контакт или ссылка на пост.");
  }

  const kind = yellowPagesEntityKind(item);
  const loc = resolveLocation(item);
  const description = descriptionFrom(item);
  const now = new Date().toISOString();
  const sourceKind = resolveSourceKind(
    sourceUrl,
    item.directory_source || item.source_channel,
  );
  const sourceType = sourceTypeFromKind(sourceKind);

  let publishedEntityType: string;
  let publishedEntityId: string;
  let publicPath: string;

  if (kind === "professional") {
    const preview = yellowPagesToProfessionalPreview(item);
    const categoryId = await lookupCategoryId(
      supabase,
      "professional",
      professionalSlugFromGuess(item.category_guess),
    );
    const slug = slugify(preview.displayName);
    const street = notesParsed.address || preview.addressLine || null;
    const { data: inserted, error: insertError } = await untyped(supabase)
      .from("professionals")
      .insert({
        owner_profile_id: null,
        created_by_profile_id: user.id,
        source_type: sourceType,
        source_record_id: item.id,
        source_url: sourceUrl,
        imported_at: now,
        import_batch_id: "admin_recommendation_approve",
        display_name: preview.displayName.slice(0, 120),
        slug,
        headline: preview.headline,
        short_description: preview.shortDescription?.slice(0, 280) || null,
        description: description || preview.description,
        image_url: preview.imageUrl,
        status: "approved",
        visibility: "public",
        category_id: categoryId,
        city: loc.city || preview.city,
        region: loc.region || notesParsed.region,
        state_code: loc.stateCode || "US-CA",
        postal_code: notesParsed.zip,
        private_address_line: street,
        location_precision: street
          ? "street"
          : loc.city
            ? "city"
            : loc.region
              ? "county"
              : null,
        public_exact_address: false,
        latitude: null,
        longitude: null,
        phone,
        email: notesParsed.email || preview.email,
        website: website || preview.website,
        instagram_url: instagram || preview.instagramUrl,
        telegram_url: telegram,
        third_party_mention_count: item.third_party_mention_count,
        self_ad_mention_count: item.self_ad_mention_count,
        published_at: now,
      })
      .select("id, slug")
      .single();
    if (insertError || !inserted) {
      return fail(insertError?.message || "Не удалось создать профи.");
    }
    publishedEntityType = "professional";
    publishedEntityId = (inserted as { id: string; slug: string }).id;
    publicPath = `/professional/${(inserted as { slug: string }).slug}`;

    await addMissingProfessionalServices(
      supabase,
      publishedEntityId,
      offersFromRecommendation(item),
    );
  } else if (kind === "service") {
    const preview = yellowPagesToServicePreview(item);
    const { data: inserted, error: insertError } = await supabase
      .from("listings")
      .insert({
        owner_id: user.id,
        listing_type: "service",
        status: "draft",
        visibility: "unlisted",
        title: preview.title.slice(0, 200),
        description: preview.description || description || "",
        city: loc.city || preview.city,
        state: loc.region || loc.stateCode?.replace(/^US-/, "") || null,
        publisher_type: "profile",
        source_url: sourceUrl,
        source_kind: sourceKind,
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      return fail(insertError?.message || "Не удалось создать услугу.");
    }
    await supabase.from("service_listing_details").upsert({
      listing_id: inserted.id,
      pricing_type: "contact_for_price",
      service_modes: ["in_person"],
      languages: ["ru"],
      service_area: [loc.city, loc.region].filter(Boolean).join(", ") || null,
    });
    const { error: statusError } = await supabase.rpc("admin_set_listing_status", {
      p_listing_id: inserted.id,
      p_status: "active",
      p_reason: "recommendation_approved",
    });
    if (statusError) {
      return fail(
        `Услуга создана как draft, активация не удалась: ${statusError.message}`,
      );
    }
    publishedEntityType = "listing";
    publishedEntityId = inserted.id;
    publicPath = `/services/${inserted.id}`;
  } else {
    const preview = yellowPagesToBusinessPreview(item);
    const categoryId = await lookupCategoryId(
      supabase,
      "business",
      businessSlugFromGuess(item.category_guess),
    );
    const slug = slugify(preview.name);
    const street = notesParsed.address || preview.addressLine || null;
    const { data: businessId, error: upsertError } = await supabase.rpc(
      "admin_upsert_business",
      {
        p_id: null,
        p_name: preview.name.trim(),
        p_slug: slug,
        p_short_description: preview.shortDescription?.slice(0, 240) || null,
        p_description: description || preview.description,
        p_phone: phone,
        p_website: website || preview.website,
        p_city: loc.city || preview.city || "",
        p_address_line: street,
        p_status: "approved",
        p_category_id: categoryId,
      },
    );
    if (upsertError) return fail(upsertError.message || "Не удалось создать бизнес.");
    publishedEntityType = "business";
    publishedEntityId = businessId as string;

    const precision = inferLocationPrecision({
      addressLine: street,
      city: loc.city || preview.city,
      region: loc.region,
    });
    await supabase
      .from("businesses")
      .update({
        source_url: sourceUrl,
        source_kind: sourceKind,
        instagram_url: instagram || preview.instagramUrl,
        telegram_url: telegram,
        image_url: preview.imageUrl,
        city: loc.city || preview.city,
        region: loc.region,
        state_code: loc.stateCode || "US-CA",
        postal_code: notesParsed.zip || undefined,
        location_precision: street
          ? "street"
          : precision === "county"
            ? "county"
            : null,
        latitude: null,
        longitude: null,
      })
      .eq("id", publishedEntityId);

    const { data: biz } = await supabase
      .from("businesses")
      .select("slug")
      .eq("id", publishedEntityId)
      .maybeSingle();
    publicPath = biz?.slug ? `/business/${biz.slug}` : "/search";
  }

  const { error: markError } = await recommendationsTable(supabase)
    .update({
      status: "approved",
      published_entity_type: publishedEntityType,
      published_entity_id: publishedEntityId,
      duplicate_of_entity_type: null,
      duplicate_of_entity_id: null,
      duplicate_confidence: null,
      duplicate_reason: null,
      target_bucket:
        kind === "professional"
          ? "professional"
          : kind === "service"
            ? "service"
            : "business",
    })
    .eq("id", item.id);

  if (markError) {
    return fail(
      `Карточка создана, но статус рекомендации не обновился: ${markError.message}`,
    );
  }

  revalidateRecommendationPaths(item);
  revalidatePath(publicPath);

  return ok("Одобрено — карточка уже на сайте.", {
    publishedEntityType,
    publishedEntityId,
    publicPath,
  });
}

/**
 * Publish a kind=event recommendation into `events` (same shape as
 * import-review events approve + facebook-collector publish script).
 * Does not invent a new moderation product — reuses recommendation row + events insert.
 */
export async function approveEventRecommendationAction(input: {
  id: string;
}): Promise<ActionResult> {
  const { supabase, user, error } = await requireAdmin();
  if (error) return error;
  if (!user) return fail("Нужно войти в аккаунт.");

  const item = await loadRecommendation(supabase, input.id);
  if (!item) return fail("Запись не найдена.");
  if (item.kind !== "event") {
    return fail("Это не event-рекомендация.");
  }

  if (item.status === "approved" && item.published_entity_id) {
    return ok("Уже одобрено ранее.", {
      publishedEntityType: "event",
      publishedEntityId: item.published_entity_id,
      publicPath: `/events`,
    });
  }

  const { structureEventFromText } = await import(
    "@/lib/events/structure-event-from-text"
  );

  const title = (item.display_name || "").trim() || "Событие";
  const rawBlob =
    [
      ...(item.request_snippets || []),
      ...(item.comment_texts || []),
      item.description_original,
    ]
      .filter((x): x is string => Boolean(x?.trim()))
      .join("\n\n") || "";
  const structured = structureEventFromText(rawBlob);

  const description =
    (item.request_snippets || []).filter(Boolean).slice(0, 2).join("\n\n") ||
    structured.description ||
    descriptionFrom(item);
  const websites = (item.websites || []).filter(
    (w) => typeof w === "string" && /^https?:\/\//i.test(w),
  );
  const registration =
    item.registration_url?.trim() ||
    structured.registrationUrl ||
    websites[0] ||
    null;
  const sourceUrl = item.source_post_urls?.[0] ?? null;
  const phone = item.phones?.[0]?.trim() || structured.phone || firstPhone(item.phones || []);
  const telegram = tgUrl(item.websites || []);
  const startsAt =
    item.starts_at ||
    structured.startsAt ||
    (() => {
      const startsAtRaw = item.event_at?.trim() || null;
      const startsAtParsed = startsAtRaw ? Date.parse(startsAtRaw) : Number.NaN;
      return Number.isNaN(startsAtParsed)
        ? null
        : new Date(startsAtParsed).toISOString();
    })();
  const eventAtLabel =
    item.event_at?.trim() || structured.eventAtLabel || null;
  const addressLine = item.address_line?.trim() || structured.addressLine || null;
  const city = item.city?.trim() || structured.city || null;
  const priceLabel = item.price_label?.trim() || structured.priceLabel || null;
  const paymentMethods =
    (item.payment_methods || []).length > 0
      ? item.payment_methods!
      : structured.paymentMethods;

  let publishedTitle = title;
  let publishedDescription = description?.slice(0, 4000) || null;
  let titleOriginal = item.title_original || null;
  let descriptionOriginal = item.description_original || null;
  let sourceLanguage = item.source_language || null;

  const alreadyHasOriginal =
    Boolean(descriptionOriginal?.trim()) &&
    descriptionOriginal!.trim() !== (publishedDescription || "").trim();
  if (!alreadyHasOriginal) {
    try {
      const { translateEventCopyToRu } = await import(
        "@/lib/events/translate-event"
      );
      const translated = await translateEventCopyToRu({
        title: publishedTitle,
        description: publishedDescription,
      });
      if (translated.detectedLanguage !== "ru") {
        publishedTitle = translated.titleRu;
        publishedDescription = translated.descriptionRu;
        titleOriginal = translated.titleOriginal;
        descriptionOriginal =
          translated.descriptionOriginal || descriptionOriginal;
        sourceLanguage = translated.detectedLanguage;
      } else if (!sourceLanguage) {
        sourceLanguage = "ru";
      }
    } catch {
      // Publish without translation if the LLM path fails.
    }
  }

  const sessions = structured.occurrences.length
    ? structured.occurrences
    : [{ label: eventAtLabel ?? "", startsAt }];

  const rows = sessions.map((session, index) => ({
    owner_profile_id: user.id,
    title: publishedTitle.slice(0, 200),
    slug:
      index === 0
        ? slugify(publishedTitle)
        : `${slugify(publishedTitle)}-${index + 1}`,
    description: publishedDescription,
    status: "published",
    starts_at: session.startsAt ?? startsAt,
    ends_at: item.ends_at || null,
    event_at_label: session.label || eventAtLabel,
    city,
    state_code: item.state_code || "US-CA",
    address_line: addressLine,
    venue_name: item.venue_name || null,
    latitude: item.latitude ?? null,
    longitude: item.longitude ?? null,
    cover_image_url: item.cover_image_url,
    registration_url: registration,
    phone,
    telegram_url: telegram,
    price_label: priceLabel,
    payment_methods: paymentMethods.length ? paymentMethods : [],
    category: item.category || null,
    tags: item.tags || [],
    source_language: sourceLanguage,
    title_original: titleOriginal,
    description_original: descriptionOriginal,
    audience_label: item.audience_label || null,
    external_source: item.external_source || item.source_channel || null,
    external_id:
      index === 0
        ? item.external_id || null
        : item.external_id
          ? `${item.external_id}:${index + 1}`
          : null,
    source_url: sourceUrl,
    source_posted_at: item.last_posted_at,
    source_body: publishedDescription,
    source_channel: item.source_channel || "facebook",
    format: "offline",
  }));

  const { data: inserted, error: insertError } = await untyped(supabase)
    .from("events")
    .insert(rows)
    .select("id, slug");

  if (insertError || !inserted?.length) {
    return fail(insertError?.message || "Не удалось создать событие.");
  }

  const publishedEntityId = (inserted as { id: string; slug: string }[])[0]!
    .id;
  const publishedSlug = (inserted as { id: string; slug: string }[])[0]!.slug;

  const { error: markError } = await recommendationsTable(supabase)
    .update({
      status: "approved",
      published_entity_type: "event",
      published_entity_id: publishedEntityId,
      target_bucket: "other",
    })
    .eq("id", item.id);

  if (markError) {
    return fail(
      `Событие создано, но статус рекомендации не обновился: ${markError.message}`,
    );
  }

  const publicPath = `/events/${publishedSlug}`;
  revalidateRecommendationPaths(item);
  revalidatePath(publicPath);

  return ok("Одобрено — событие на сайте.", {
    publishedEntityType: "event",
    publishedEntityId,
    publicPath,
  });
}

/** Structure free-text event body into pending recommendation fields (pre-publish). */
export async function structureEventRecommendationAction(input: {
  id: string;
}): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const item = await loadRecommendation(supabase, input.id);
  if (!item) return fail("Запись не найдена.");
  if (item.kind !== "event") return fail("Это не event-рекомендация.");
  if (item.status === "approved") {
    return fail("Уже одобрено — правьте опубликованную карточку.");
  }

  const { structureEventFromText } = await import(
    "@/lib/events/structure-event-from-text"
  );
  const blob = [
    ...(item.request_snippets || []),
    ...(item.comment_texts || []),
    item.description_original,
  ]
    .filter((x): x is string => Boolean(x?.trim()))
    .join("\n\n");
  if (!blob.trim()) return fail("Нет текста для структурирования.");

  const structured = structureEventFromText(blob);
  const patch: Record<string, unknown> = {
    event_at: structured.eventAtLabel || item.event_at,
    starts_at: structured.startsAt || item.starts_at || null,
    address_line: structured.addressLine || item.address_line || null,
    city: structured.city || item.city || null,
    price_label: structured.priceLabel || item.price_label || null,
    payment_methods:
      structured.paymentMethods.length > 0
        ? structured.paymentMethods
        : item.payment_methods || [],
    registration_url:
      structured.registrationUrl || item.registration_url || null,
  };
  if (structured.phone) {
    const phones = new Set([...(item.phones || []), structured.phone]);
    patch.phones = [...phones];
  }
  if (structured.description) {
    patch.request_snippets = [structured.description];
  }
  if (structured.website.length) {
    const sites = new Set([...(item.websites || []), ...structured.website]);
    patch.websites = [...sites];
  }

  const { error: updError } = await recommendationsTable(supabase)
    .update(patch)
    .eq("id", item.id);
  if (updError) return fail(updError.message || "Не удалось сохранить.");

  revalidateRecommendationPaths(item);
  return ok("Структура обновлена.");
}

/** Translate pending event EN → RU; keep originals on the row. */
export async function translateEventRecommendationAction(input: {
  id: string;
}): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const item = await loadRecommendation(supabase, input.id);
  if (!item) return fail("Запись не найдена.");
  if (item.kind !== "event") return fail("Это не event-рекомендация.");
  if (item.status === "approved") {
    return fail("Уже одобрено — правьте опубликованную карточку.");
  }

  const title = (item.display_name || "").trim();
  const description =
    (item.request_snippets || []).filter(Boolean).join("\n\n") ||
    (item.comment_texts || []).filter(Boolean).slice(0, 2).join("\n\n") ||
    null;
  if (!title && !description) return fail("Нет текста для перевода.");

  try {
    const { translateEventCopyToRu } = await import(
      "@/lib/events/translate-event"
    );
    const translated = await translateEventCopyToRu({
      title: title || "Event",
      description,
    });

    const patch: Record<string, unknown> = {
      display_name: translated.titleRu,
      title_original: translated.titleOriginal,
      description_original:
        translated.descriptionOriginal || item.description_original || null,
      source_language: translated.detectedLanguage,
    };
    if (translated.descriptionRu) {
      patch.request_snippets = [translated.descriptionRu];
    }

    const { error: updError } = await recommendationsTable(supabase)
      .update(patch)
      .eq("id", item.id);
    if (updError) return fail(updError.message || "Не удалось сохранить.");

    revalidateRecommendationPaths(item);
    return ok(
      translated.detectedLanguage === "ru"
        ? "Уже на русском — без перевода."
        : `Переведено (${translated.modelUsed}).`,
    );
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "Ошибка перевода.";
    return fail(message);
  }
}

/** Lightweight field edits for recommendation / event verification workspace. */
export async function saveCommentRecommendationFieldsAction(input: {
  id: string;
  displayName?: string | null;
  city?: string | null;
  notes?: string | null;
  eventAt?: string | null;
  addressLine?: string | null;
  venueName?: string | null;
  priceLabel?: string | null;
  category?: string | null;
  registrationUrl?: string | null;
}): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const item = await loadRecommendation(supabase, input.id);
  if (!item) return fail("Запись не найдена.");
  if (item.status === "approved") {
    return fail("Уже одобрено — правьте опубликованную карточку.");
  }

  const patch: Record<string, string | null> = {};
  if (input.displayName !== undefined) {
    patch.display_name = input.displayName?.trim() || null;
  }
  if (input.city !== undefined) {
    patch.city = input.city?.trim() || null;
  }
  if (input.notes !== undefined) {
    patch.notes = input.notes?.trim() || null;
  }
  if (input.eventAt !== undefined) {
    patch.event_at = input.eventAt?.trim() || null;
  }
  if (input.addressLine !== undefined) {
    patch.address_line = input.addressLine?.trim() || null;
  }
  if (input.venueName !== undefined) {
    patch.venue_name = input.venueName?.trim() || null;
  }
  if (input.priceLabel !== undefined) {
    patch.price_label = input.priceLabel?.trim() || null;
  }
  if (input.category !== undefined) {
    patch.category = input.category?.trim() || null;
  }
  if (input.registrationUrl !== undefined) {
    patch.registration_url = input.registrationUrl?.trim() || null;
  }

  if (Object.keys(patch).length === 0) {
    return fail("Нет полей для сохранения.");
  }

  const { error: updError } = await recommendationsTable(supabase)
    .update(patch)
    .eq("id", input.id);
  if (updError) return fail(updError.message || "Не удалось сохранить.");

  revalidateRecommendationPaths(item);
  return ok("Сохранено.");
}

export type RecommendationActionResult = ActionResult;
