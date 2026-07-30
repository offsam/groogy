"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { userIsAdmin } from "@/lib/reviews/queries";
import { mergeLocationWithGroupFallback } from "@/lib/geo/source-group-location";
import {
  isResolvedLocation,
  resolveEntityLocation,
  type ResolvedEntityLocation,
} from "@/lib/geo/resolve-entity-location";
import {
  geocodeStreetAddress,
  googleMapsUrlForAddress,
} from "@/lib/geo/geocode-street";
import { inferLocationPrecision } from "@/lib/business/location-precision";
import {
  resolveSourceKind,
  sourceTypeFromKind,
} from "@/lib/business/presence";
import { resolveImportDisplayName } from "@/lib/import-review/display-name";
import {
  addMissingProfessionalServices,
  offersFromAdTexts,
  offersFromServiceNames,
  type ImportedOffer,
} from "@/lib/professional/import-services";
import { addMissingBusinessOffers } from "@/lib/business-offers/import-offers";
import { addMissingEntityPromotions } from "@/lib/promotions/queries";
import { promotionsFromAdText } from "@/lib/promotions/extract";
import { addMissingEntityUpdates } from "@/lib/updates/queries";
import { updatesFromAdText } from "@/lib/updates/extract";
import type { QueuePromotion } from "@/types/promotion";
import type { QueueUpdate } from "@/types/update";
import {
  narrativeWithContactPointer,
  shortNarrativeTeaser,
} from "@/lib/content/structure-business-profile";
import { isSharedNonIdentityHost } from "@/lib/import-review/shared-hosts";
import {
  parseProfessionalCleanupPayload,
  type ProfessionalCleanupPayload,
} from "@/lib/import-review/professional-cleanup";
import { afterImportReviewSettledRetention } from "@/lib/import-review/retention";
import {
  findQueueTwins,
  mergeQueueItems,
  MERGE_SELECT,
  type MergeableQueueItem,
} from "@/lib/import-review/merge-queue-items";
import { structureEventFromText } from "@/lib/events/structure-event-from-text";
import type {
  ImportReviewEntityType,
  ImportReviewItem,
  ImportReviewStatus,
  ImportReviewTargetCollection,
} from "@/types/import-review";

/** Untyped access until generated Database types include professionals/events. */
function untyped(client: SupabaseClient) {
  return client as unknown as SupabaseClient<any>;
}

/** Best-effort storage retention after settle; never fails the parent action. */
async function runSettledRetention(opts: {
  itemId: string;
  previewImageUrl?: string | null;
  publishedEntityType?: string | null;
  publishedEntityId?: string | null;
}) {
  try {
    const service = createServiceRoleClient();
    await afterImportReviewSettledRetention(service, opts);
  } catch {
    // ignore — payload compaction already happens in DB trigger
  }
}

async function archiveLinkedCleanupProfessional(
  supabase: SupabaseClient,
  cleanup: ProfessionalCleanupPayload | null,
): Promise<void> {
  if (!cleanup?.existing_professional_id) return;
  await untyped(supabase)
    .from("professionals")
    .update({
      status: "archived",
      visibility: "private",
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      import_batch_id: "import_review_cleanup_archive",
    })
    .eq("id", cleanup.existing_professional_id)
    .neq("status", "archived");
}

function resolveImportLocation(item: {
  city?: string | null;
  state?: string | null;
  source_group?: string | null;
  source?: string | null;
  source_url?: string | null;
  source_chat_id?: string | null;
  description?: string | null;
  source_text?: string | null;
  address_line?: string | null;
  postal_code?: string | null;
  county_geoid?: string | null;
}) {
  return mergeLocationWithGroupFallback({
    city: item.city,
    region: item.state,
    sourceGroup: item.source_group,
    source: item.source ?? item.source_url,
    chatId: item.source_chat_id,
    text: [item.description, item.source_text].filter(Boolean).join("\n"),
  });
}

async function resolveAndPersistImportLocation(
  supabase: SupabaseClient,
  item: ImportReviewItem,
): Promise<
  | { ok: true; loc: ResolvedEntityLocation }
  | { ok: false; message: string }
> {
  const merged = resolveImportLocation(item);
  const result = await resolveEntityLocation(supabase, {
    postalCode: item.postal_code ?? null,
    city: merged.city ?? item.city,
    region: merged.region ?? item.state,
    stateCode: merged.stateCode,
    sourceGroup: item.source_group,
    source: item.source ?? item.source_url,
    chatId: item.source_chat_id,
    text: [item.description, item.source_text].filter(Boolean).join("\n"),
    countyGeoid: item.county_geoid ?? merged.countyGeoid,
    locationSource: item.location_source ?? undefined,
  });

  if (!isResolvedLocation(result)) {
    return { ok: false, message: result.reason };
  }

  await untyped(supabase)
    .from("import_review_items")
    .update({
      city: result.city,
      state: result.region || result.stateCode,
      county_geoid: result.countyGeoid,
      postal_code: result.postalCode ?? item.postal_code ?? null,
      location_source: result.locationSource,
      location_confidence: result.locationConfidence,
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id);

  return { ok: true, loc: result };
}

export type ImportReviewActionResult =
  | {
      ok: true;
      message?: string;
      id?: string;
      publishedEntityType?: string;
      publishedEntityId?: string;
      duplicates?: DuplicateMatch[];
    }
  | { ok: false; message: string; duplicates?: DuplicateMatch[] };

export type DuplicateMatch = {
  kind: "business" | "listing" | "import_item";
  id: string;
  title: string | null;
  reason: string;
  slug?: string | null;
  /** Live business status when kind=business */
  businessStatus?: string | null;
  /** What merge into this match would do (fill-empty preview). */
  mergePreview?: MergePreview;
};

export type MergePreview = {
  summary: string;
  willAdd: string[];
  willSkip: string[];
  queueEffect: string;
};

function emptyStr(v: unknown): boolean {
  return !(typeof v === "string" && v.trim());
}

function firstArr(v: string[] | null | undefined): string | null {
  if (!v?.length) return null;
  for (const x of v) {
    const t = String(x || "").trim();
    if (t) return t;
  }
  return null;
}

function websiteFromQueue(websites: string[] | null | undefined): string | null {
  if (!websites?.length) return null;
  for (const w of websites) {
    const t = String(w || "").trim();
    if (!t) continue;
    if (/instagram\.com|facebook\.com|fb\.com|t\.me|wa\.me/i.test(t)) continue;
    let host = "";
    try {
      const href = /^https?:\/\//i.test(t) ? t : `https://${t}`;
      host = new URL(href).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      host = t.toLowerCase();
    }
    if (isSharedNonIdentityHost(host) || isSharedNonIdentityHost(t)) continue;
    return t;
  }
  return null;
}

function offersFromQueueItem(item: {
  services?: string[] | null;
  description?: string | null;
  source_text?: string | null;
}): ImportedOffer[] {
  const fromNames = offersFromServiceNames(item.services);
  const fromText = offersFromAdTexts([item.description, item.source_text]);
  const seen = new Set(fromNames.map((o) => o.title.toLowerCase()));
  const merged = [...fromNames];
  for (const offer of fromText) {
    const key = offer.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(offer);
  }
  return merged;
}

function promotionsFromQueueItem(item: {
  promotions?: QueuePromotion[] | null;
  description?: string | null;
  source_text?: string | null;
}): QueuePromotion[] {
  if (Array.isArray(item.promotions) && item.promotions.length) {
    return item.promotions;
  }
  return promotionsFromAdText(
    [item.description, item.source_text].filter(Boolean).join("\n"),
  );
}

function updatesFromQueueItem(item: {
  updates?: QueueUpdate[] | null;
  description?: string | null;
  source_text?: string | null;
}): QueueUpdate[] {
  if (Array.isArray(item.updates) && item.updates.length) {
    return item.updates;
  }
  return updatesFromAdText(
    [item.description, item.source_text].filter(Boolean).join("\n"),
  );
}

function cleanQueueDescription(item: {
  description?: string | null;
  source_text?: string | null;
}): string | null {
  return narrativeWithContactPointer(
    item.description?.trim() || item.source_text?.trim() || null,
  ).text;
}

function igUrlFromQueue(instagram: string[] | null | undefined): string | null {
  const raw = firstArr(instagram);
  if (!raw) return null;
  const handle = raw.replace(/^@+/, "").trim();
  if (!handle) return null;
  if (/^https?:\/\//i.test(handle)) return handle;
  return `https://www.instagram.com/${handle}`;
}

async function buildBusinessMergePreview(
  supabase: SupabaseClient,
  itemId: string,
  businessId: string,
): Promise<MergePreview> {
  const { data: item } = await supabase
    .from("import_review_items")
    .select(
      "phone, email, website, instagram, city, state, description, source_text, preview_image_url, title, business_name, services",
    )
    .eq("id", itemId)
    .maybeSingle();
  const { data: biz } = await supabase
    .from("businesses")
    .select(
      "id, name, slug, status, phone, email, website, instagram_url, city, state_code, short_description, description, image_url, category_id",
    )
    .eq("id", businessId)
    .maybeSingle();

  if (!item || !biz) {
    return {
      summary: "Не удалось построить превью",
      willAdd: [],
      willSkip: [],
      queueEffect: "Очередь: без изменений (ошибка превью)",
    };
  }

  const archived = biz.status === "archived";

  const qPhone = firstArr(item.phone as string[] | null);
  const qEmail = firstArr(item.email as string[] | null)?.toLowerCase() || null;
  const qWeb = websiteFromQueue(item.website as string[] | null);
  const qIg = igUrlFromQueue(item.instagram as string[] | null);
  const qCity = (item.city as string | null)?.trim() || null;
  const qState = (item.state as string | null)?.trim() || null;
  const qDesc = cleanQueueDescription(item);
  const qShort = shortNarrativeTeaser(qDesc, 240);
  const qImage = (item.preview_image_url as string | null)?.trim() || null;
  const offers = offersFromQueueItem(item);

  const willAdd: string[] = [];
  const willSkip: string[] = [];

  const check = (
    label: string,
    queueVal: string | null,
    bizVal: unknown,
  ) => {
    if (!queueVal) return;
    if (emptyStr(bizVal)) willAdd.push(`${label}: ${queueVal.slice(0, 80)}`);
    else willSkip.push(`${label} уже есть`);
  };

  check("телефон", qPhone, biz.phone);
  check("email", qEmail, biz.email);
  check("сайт", qWeb, biz.website);
  check("instagram", qIg, biz.instagram_url);
  check("город", qCity, biz.city);
  check("штат", qState, biz.state_code);
  check("краткое описание", qShort, biz.short_description);
  check("фото", qImage, biz.image_url);

  if (qDesc) {
    if (emptyStr(biz.description)) {
      willAdd.push("описание (заполнить)");
    } else if (
      qDesc.length >= 80 &&
      qDesc.length > String(biz.description || "").length + 60
    ) {
      willAdd.push("описание (дописать)");
    } else {
      willSkip.push("описание уже достаточно");
    }
  }

  if (offers.length) {
    willAdd.push(
      `услуги: +${offers.length} (${offers
        .slice(0, 3)
        .map((o) => o.title)
        .join(", ")}${offers.length > 3 ? "…" : ""})`,
    );
  }

  const promos = promotionsFromQueueItem(item);
  if (promos.length) {
    willAdd.push(
      `акции: +${promos.length} (${promos
        .slice(0, 2)
        .map((p) => p.title.slice(0, 40))
        .join(", ")}${promos.length > 2 ? "…" : ""})`,
    );
  }

  const updates = updatesFromQueueItem(item);
  if (updates.length) {
    willAdd.push(
      `обновления: +${updates.length} (${updates
        .slice(0, 2)
        .map((u) => u.title.slice(0, 40))
        .join(", ")}${updates.length > 2 ? "…" : ""})`,
    );
  }

  const name = biz.name || "бизнес";
  if (archived) {
    willAdd.unshift("статус: вернуть из архива → published");
  }
  const summary =
    willAdd.length > 0
      ? `В «${name}»${archived ? " (сейчас в архиве)" : ""} добавится: ${willAdd.map((x) => x.split(":")[0]).join(", ")}`
      : `В «${name}»${archived ? " (сейчас в архиве)" : ""} новых полей нет — только привязка очереди`;

  return {
    summary,
    willAdd,
    willSkip,
    queueEffect: archived
      ? `Бизнес разархивируем и привяжем очередь к «${name}» (новая карточка не создаётся)`
      : `Очередь закроется как одобренная и привязанная к «${name}» (не создаст новую карточку)`,
  };
}

async function buildImportItemMergePreview(
  supabase: SupabaseClient,
  sourceItemId: string,
  targetItemId: string,
  title: string | null,
): Promise<MergePreview> {
  const { data: target } = await supabase
    .from("import_review_items")
    .select("id, title, published_entity_type, published_entity_id")
    .eq("id", targetItemId)
    .maybeSingle();

  const publishedType = target?.published_entity_type ?? null;
  const publishedId = target?.published_entity_id ?? null;

  if (publishedType === "business" && publishedId) {
    const preview = await buildBusinessMergePreview(
      supabase,
      sourceItemId,
      publishedId,
    );
    return {
      ...preview,
      queueEffect: `Очередь привяжем к уже опубликованному бизнесу через импорт «${title || "item"}»`,
    };
  }

  if (publishedType === "professional" && publishedId) {
    const { data: item } = await supabase
      .from("import_review_items")
      .select("description, source_text, services, promotions, updates")
      .eq("id", sourceItemId)
      .maybeSingle();
    const offers = offersFromQueueItem(item ?? {});
    const promos = promotionsFromQueueItem(item ?? {});
    const updates = updatesFromQueueItem(item ?? {});
    const willAdd: string[] = [];
    if (offers.length) {
      willAdd.push(
        `услуги: +${offers.length} (${offers
          .slice(0, 3)
          .map((o) => o.title)
          .join(", ")}${offers.length > 3 ? "…" : ""})`,
      );
    }
    if (promos.length) willAdd.push(`акции: +${promos.length}`);
    if (updates.length) willAdd.push(`обновления: +${updates.length}`);
    return {
      summary: willAdd.length
        ? `В опубликованного специалиста добавятся: ${willAdd.join("; ")}`
        : `Привяжем к опубликованному специалисту «${title || "item"}»`,
      willAdd,
      willSkip: willAdd.length
        ? []
        : ["Новых услуг/акций/обновлений не найдено — только привязка"],
      queueEffect:
        "Очередь: approved → existing professional (fill-empty + услуги/акции/обновления)",
    };
  }

  if (publishedType && publishedId) {
    const offers = offersFromQueueItem(
      (
        await supabase
          .from("import_review_items")
          .select("description, source_text, services")
          .eq("id", sourceItemId)
          .maybeSingle()
      ).data ?? {},
    );
    return {
      summary: `Пометить дубликатом уже опубликованного «${title || "item"}» (${publishedType})`,
      willAdd: offers.length
        ? [`услуги найдены (${offers.length}), но цель — ${publishedType}`]
        : [],
      willSkip: [
        "Данные в каталог не переносятся автоматически для этого типа",
      ],
      queueEffect: `Очередь: status=duplicate → ${publishedType}:${publishedId}`,
    };
  }

  return {
    summary: `Пометить текущую запись дубликатом уже одобренного импорта «${title || "item"}»`,
    willAdd: [],
    willSkip: ["Данные в каталог не переносятся — только статус duplicate"],
    queueEffect:
      "Очередь: status=duplicate, без новой публикации и без fill-empty в live",
  };
}

async function attachMergePreviews(
  supabase: SupabaseClient,
  itemId: string,
  matches: DuplicateMatch[],
): Promise<DuplicateMatch[]> {
  const out: DuplicateMatch[] = [];
  for (const m of matches.slice(0, 8)) {
    if (m.kind === "business") {
      out.push({
        ...m,
        mergePreview: await buildBusinessMergePreview(supabase, itemId, m.id),
      });
    } else if (m.kind === "import_item") {
      out.push({
        ...m,
        mergePreview: await buildImportItemMergePreview(
          supabase,
          itemId,
          m.id,
          m.title,
        ),
      });
    } else {
      out.push({
        ...m,
        mergePreview: {
          summary: `Пометить дубликатом listing ${m.title || m.id}`,
          willAdd: [],
          willSkip: ["Авто-fill для listing из этой кнопки не делается"],
          queueEffect: "Очередь: status=duplicate",
        },
      });
    }
  }
  return out;
}

function fail(
  message: string,
  duplicates?: DuplicateMatch[],
): ImportReviewActionResult {
  return { ok: false, message, duplicates };
}

function ok(
  message?: string,
  extra?: {
    id?: string;
    publishedEntityType?: string;
    publishedEntityId?: string;
    duplicates?: DuplicateMatch[];
  },
): ImportReviewActionResult {
  return { ok: true, message, ...extra };
}

function mapDbError(error: { message?: string; code?: string } | null): string {
  const message = (error?.message ?? "").toLowerCase();
  if (message.includes("admin only")) return "Только для администраторов.";
  if (message.includes("reject_reason required")) {
    return "Укажите причину отклонения.";
  }
  if (message.includes("notes required")) {
    return "Добавьте заметку.";
  }
  if (message.includes("cannot edit approved")) {
    return "Одобренную карточку нельзя редактировать.";
  }
  if (message.includes("cannot change status of approved")) {
    return "Статус одобренной карточки нельзя менять.";
  }
  if (message.includes("duplicate target required")) {
    return "Укажите карточку-дубликат.";
  }
  if (message.includes("not found")) return "Запись не найдена.";
  if (
    message.includes("businesses_slug_key") ||
    message.includes("duplicate key") ||
    error?.code === "23505"
  ) {
    return "Карточка с таким slug уже есть. Измените название или одобрите принудительно после правки.";
  }
  if (message.includes("name required") || message.includes("slug required")) {
    return "Нужно название (title / business_name / person_name).";
  }
  return error?.message || "Не удалось выполнить действие.";
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
  return `${base || "import"}-${stamp}`;
}

export type ImportReviewEditableFields = {
  entity_type?: ImportReviewEntityType | null;
  target_collection?: ImportReviewTargetCollection | null;
  category?: string | null;
  subcategory?: string | null;
  title?: string | null;
  business_name?: string | null;
  person_name?: string | null;
  description?: string | null;
  services?: string[];
  payment_methods?: string[];
  price?: number | null;
  currency?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string[];
  whatsapp?: string[];
  telegram_username?: string | null;
  telegram_user_id?: string | null;
  instagram?: string[];
  website?: string[];
  email?: string[];
  review_notes?: string | null;
};

export async function saveImportReviewItemAction(input: {
  id: string;
  fields: ImportReviewEditableFields;
}): Promise<ImportReviewActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { error: rpcError } = await supabase.rpc(
    "admin_import_review_save_fields",
    {
      p_item_id: input.id,
      p_fields: input.fields,
    },
  );
  if (rpcError) return fail(mapDbError(rpcError));

  revalidatePath("/admin/import-review");
  revalidatePath(`/admin/import-review/${input.id}`);
  revalidatePath("/admin/review/inbox");
  revalidatePath(`/admin/review/${encodeURIComponent(`import_review:${input.id}`)}`);
  return ok("Сохранено.");
}

export async function setImportReviewStatusAction(input: {
  id: string;
  status: ImportReviewStatus;
  notes?: string;
  rejectReason?: string;
  duplicateOfItemId?: string;
  duplicateOfEntityType?: string;
  duplicateOfEntityId?: string;
}): Promise<ImportReviewActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { data: itemRow } = await supabase
    .from("import_review_items")
    .select("id, raw_payload")
    .eq("id", input.id)
    .maybeSingle();
  const cleanup = parseProfessionalCleanupPayload(itemRow?.raw_payload);

  const { error: rpcError } = await supabase.rpc(
    "admin_import_review_set_status",
    {
      p_item_id: input.id,
      p_status: input.status,
      p_notes: input.notes ?? null,
      p_reject_reason: input.rejectReason ?? null,
      p_duplicate_of_item_id: input.duplicateOfItemId ?? null,
      p_duplicate_of_entity_type: input.duplicateOfEntityType ?? null,
      p_duplicate_of_entity_id: input.duplicateOfEntityId ?? null,
    },
  );
  if (rpcError) return fail(mapDbError(rpcError));

  // Cleanup handoff: Reject / Duplicate archives the linked live Professional.
  if (
    cleanup &&
    (input.status === "rejected" || input.status === "duplicate")
  ) {
    await archiveLinkedCleanupProfessional(supabase, cleanup);
  }

  if (
    input.status === "approved" ||
    input.status === "rejected" ||
    input.status === "duplicate"
  ) {
    const { data: settledRow } = await supabase
      .from("import_review_items")
      .select("preview_image_url, published_entity_type, published_entity_id")
      .eq("id", input.id)
      .maybeSingle();
    await runSettledRetention({
      itemId: input.id,
      previewImageUrl: settledRow?.preview_image_url,
      publishedEntityType: settledRow?.published_entity_type,
      publishedEntityId: settledRow?.published_entity_id,
    });
  }

  revalidatePath("/admin/import-review");
  revalidatePath(`/admin/import-review/${input.id}`);
  revalidatePath("/admin");

  const messages: Record<ImportReviewStatus, string> = {
    pending: "Статус: ожидает проверки.",
    in_review: "Карточка взята в работу.",
    approved: "Одобрено.",
    rejected: cleanup
      ? "Отклонено. Связанный Professional архивирован."
      : "Отклонено.",
    duplicate: cleanup
      ? "Помечено как дубликат. Связанный Professional архивирован."
      : "Помечено как дубликат.",
    needs_more_info: "Отмечено: нужна информация.",
    ready_to_publish: "Готова к публикации.",
  };
  return ok(messages[input.status] ?? "Статус обновлён.");
}

/** Explicit duplicate scan for inbox — same matches Approve would block on. */
export async function scanImportReviewDuplicatesAction(input: {
  id: string;
}): Promise<ImportReviewActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { data: item, error: loadError } = await supabase
    .from("import_review_items")
    .select("*")
    .eq("id", input.id)
    .maybeSingle();
  if (loadError) return fail(mapDbError(loadError));
  if (!item) return fail("Запись не найдена.");

  const duplicates = await findDuplicateMatches(
    supabase,
    item as unknown as MergeableQueueItem,
  );
  if (duplicates.length === 0) {
    return ok("Совпадений не найдено.");
  }
  const withPreview = await attachMergePreviews(supabase, input.id, duplicates);
  return fail(
    `Найдено совпадений: ${withPreview.length}. Проверьте и объедините или одобрите как новую.`,
    withPreview,
  );
}

/**
 * One click for a reposted ad: fold every open copy of it into a single card.
 * Copies are found by repost cluster, Telegram account and phone.
 */
export async function mergeQueueDuplicatesAction(input: {
  id: string;
}): Promise<ImportReviewActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { data: item, error: loadError } = await untyped(supabase)
    .from("import_review_items")
    .select(MERGE_SELECT)
    .eq("id", input.id)
    .maybeSingle();
  if (loadError) return fail(mapDbError(loadError));
  if (!item) return fail("Запись не найдена.");

  try {
    const twins = await findQueueTwins(
      untyped(supabase),
      item as unknown as MergeableQueueItem,
    );
    if (!twins.length) return ok("Копий в очереди не найдено.");

    const merged = await mergeQueueItems(untyped(supabase), [
      input.id,
      ...twins.map((twin) => twin.row.id),
    ]);
    if (!merged) return ok("Копий в очереди не найдено.");

    revalidatePath("/admin/import-review");
    revalidatePath("/admin/review/inbox");
    revalidatePath(`/admin/review/workspace/import_review/${merged.survivorId}`);
    return ok(
      `Свёрнуто копий: ${merged.mergedCount}. Осталась карточка «${
        merged.survivorTitle || merged.survivorId
      }»${merged.changed.length ? `, дополнено: ${merged.changed.join(", ")}` : ""}.`,
      { id: merged.survivorId },
    );
  } catch (err) {
    return fail(
      err instanceof Error ? err.message : "Не удалось свернуть копии",
    );
  }
}

/**
 * Merge queue item into an existing match (fill-empty for businesses via RPC;
 * import_item → mark duplicate of that item).
 * Flat args — надёжнее для server actions, чем вложенный объект.
 */
export async function mergeImportReviewIntoExistingAction(input: {
  id: string;
  matchKind: DuplicateMatch["kind"];
  matchId: string;
  matchTitle?: string | null;
  matchReason?: string | null;
  matchSlug?: string | null;
}): Promise<ImportReviewActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const matchKind = input.matchKind;
  const matchId = (input.matchId || "").trim();
  if (!matchId) return fail("Нет id совпадения для объединения.");

  if (matchKind === "business") {
    let catalog: ReturnType<typeof createServiceRoleClient>;
    try {
      catalog = createServiceRoleClient();
    } catch (err) {
      return fail(
        err instanceof Error
          ? err.message
          : "Нет service role — объединение недоступно.",
      );
    }
    try {
      const { data: bizRow, error: bizErr } = await untyped(catalog)
        .from("businesses")
        .select("id, name, slug, status")
        .eq("id", matchId)
        .maybeSingle();
      if (bizErr) return fail(bizErr.message);
      if (!bizRow) return fail("Бизнес не найден.");

      const biz = bizRow as {
        id: string;
        name: string | null;
        slug: string | null;
        status: string;
      };

      // Enrich RPC rejects archived — restore to approved first.
      if (biz.status === "archived") {
        const { error: unarchiveErr } = await untyped(catalog)
          .from("businesses")
          .update({
            status: "approved",
            updated_at: new Date().toISOString(),
          })
          .eq("id", matchId);
        if (unarchiveErr) {
          return fail(
            `Не удалось разархивировать бизнес: ${unarchiveErr.message}`,
          );
        }
      }

      const { data, error: rpcError } = await untyped(catalog).rpc(
        "service_enrich_business_from_queue",
        {
          p_item_id: input.id,
          p_business_id: matchId,
          p_note: `Merge из inbox: ${input.matchReason || "match"}${
            biz.status === "archived" ? " (разархивирован)" : ""
          }`,
        },
      );
      if (rpcError) {
        return fail(
          rpcError.message ||
            mapDbError(rpcError) ||
            "RPC service_enrich_business_from_queue failed",
        );
      }
      const result = (data ?? {}) as {
        ok?: boolean;
        filled?: string[];
        business_name?: string;
      };
      revalidatePath("/admin/import-review");
      revalidatePath(`/admin/import-review/${input.id}`);
      revalidatePath("/admin/review/inbox");
      revalidatePath(
        `/admin/review/${encodeURIComponent(`import_review:${input.id}`)}`,
      );
      const slug = input.matchSlug || biz.slug;
      if (slug) revalidatePath(`/business/${slug}`);
      revalidatePath("/search");
      revalidatePath("/admin/catalog/businesses");
      const filled = Array.isArray(result.filled) ? result.filled : [];
      const name = result.business_name || input.matchTitle || biz.name || matchId;
      const restored =
        biz.status === "archived" ? " Разархивирован." : "";

      const { data: queueItemRaw } = await supabase
        .from("import_review_items")
        .select("description, source_text, services, promotions, updates")
        .eq("id", input.id)
        .maybeSingle();
      const queueItem = (queueItemRaw ?? {}) as {
        description?: string | null;
        source_text?: string | null;
        services?: string[] | null;
        promotions?: QueuePromotion[] | null;
        updates?: QueueUpdate[] | null;
      };
      const offersAdded = await addMissingBusinessOffers(
        catalog,
        matchId,
        offersFromQueueItem(queueItem),
      );
      const promosAdded = await addMissingEntityPromotions(
        catalog,
        "business",
        matchId,
        promotionsFromQueueItem(queueItem),
      );
      const updatesAdded = await addMissingEntityUpdates(
        catalog,
        "business",
        matchId,
        updatesFromQueueItem(queueItem),
        { source: "import" },
      );

      const { data: settledPreview } = await supabase
        .from("import_review_items")
        .select("preview_image_url")
        .eq("id", input.id)
        .maybeSingle();
      await runSettledRetention({
        itemId: input.id,
        previewImageUrl: settledPreview?.preview_image_url,
        publishedEntityType: "business",
        publishedEntityId: matchId,
      });

      return ok(
        [
          filled.length
            ? `Объединено с «${name}»: добавлено ${filled.join(", ")}.`
            : `Объединено с «${name}» (новых полей не было).`,
          offersAdded
            ? ` Услуг добавлено: ${offersAdded}.`
            : "",
          promosAdded ? ` Акций добавлено: ${promosAdded}.` : "",
          updatesAdded ? ` Обновлений добавлено: ${updatesAdded}.` : "",
          restored,
        ].join(""),
        {
          id: input.id,
          publishedEntityType: "business",
          publishedEntityId: matchId,
        },
      );
    } catch (err) {
      return fail(
        err instanceof Error ? err.message : "Не удалось объединить с бизнесом",
      );
    }
  }

  if (matchKind === "import_item") {
    const { data: target } = await supabase
      .from("import_review_items")
      .select("id, title, published_entity_type, published_entity_id")
      .eq("id", matchId)
      .maybeSingle();

    if (
      target?.published_entity_type === "business" &&
      target.published_entity_id
    ) {
      return mergeImportReviewIntoExistingAction({
        ...input,
        matchKind: "business",
        matchId: target.published_entity_id,
        matchTitle: target.title || input.matchTitle,
      });
    }

    if (
      target?.published_entity_type === "professional" &&
      target.published_entity_id
    ) {
      let catalog: ReturnType<typeof createServiceRoleClient>;
      try {
        catalog = createServiceRoleClient();
      } catch (err) {
        return fail(
          err instanceof Error
            ? err.message
            : "Нет service role — объединение недоступно.",
        );
      }
      const { data: queueItemRaw } = await supabase
        .from("import_review_items")
        .select("description, source_text, services, promotions, updates")
        .eq("id", input.id)
        .maybeSingle();
      const queueItem = (queueItemRaw ?? {}) as {
        description?: string | null;
        source_text?: string | null;
        services?: string[] | null;
        promotions?: QueuePromotion[] | null;
        updates?: QueueUpdate[] | null;
      };
      const offersAdded = await addMissingProfessionalServices(
        catalog,
        target.published_entity_id,
        offersFromQueueItem(queueItem),
      );
      const promosAdded = await addMissingEntityPromotions(
        catalog,
        "professional",
        target.published_entity_id,
        promotionsFromQueueItem(queueItem),
      );
      const updatesAdded = await addMissingEntityUpdates(
        catalog,
        "professional",
        target.published_entity_id,
        updatesFromQueueItem(queueItem),
        { source: "import" },
      );
      const mark = await setImportReviewStatusAction({
        id: input.id,
        status: "approved",
        notes: `Объединено с professional ${target.published_entity_id} через import item ${matchId}`,
      });
      if (!mark.ok) return mark;
      // Link to published professional.
      await untyped(supabase)
        .from("import_review_items")
        .update({
          published_entity_type: "professional",
          published_entity_id: target.published_entity_id,
          review_status: "approved",
          updated_at: new Date().toISOString(),
        })
        .eq("id", input.id);
      revalidatePath("/admin/import-review");
      revalidatePath(`/admin/import-review/${input.id}`);
      revalidatePath("/admin/review/inbox");
      return ok(
        [
          "Объединено со специалистом.",
          offersAdded ? ` Услуг: +${offersAdded}.` : "",
          promosAdded ? ` Акций: +${promosAdded}.` : "",
          updatesAdded ? ` Обновлений: +${updatesAdded}.` : "",
        ].join(""),
        {
          id: input.id,
          publishedEntityType: "professional",
          publishedEntityId: target.published_entity_id,
        },
      );
    }

    // Both rows are still in the queue: fold them into one card instead of
    // closing this one, so services and contacts from both survive.
    try {
      const merged = await mergeQueueItems(untyped(supabase), [
        input.id,
        matchId,
      ]);
      if (merged) {
        revalidatePath("/admin/import-review");
        revalidatePath("/admin/review/inbox");
        revalidatePath(`/admin/review/workspace/import_review/${merged.survivorId}`);
        return ok(
          `Копии объединены в «${merged.survivorTitle || merged.survivorId}»${
            merged.changed.length ? `: дополнено ${merged.changed.join(", ")}` : ""
          }.`,
          { id: merged.survivorId },
        );
      }
    } catch (err) {
      return fail(
        err instanceof Error ? err.message : "Не удалось объединить копии",
      );
    }

    return setImportReviewStatusAction({
      id: input.id,
      status: "duplicate",
      duplicateOfItemId: matchId,
      notes: `Дубликат import item: ${input.matchReason || ""}`,
    });
  }

  return setImportReviewStatusAction({
    id: input.id,
    status: "duplicate",
    duplicateOfEntityType: matchKind,
    duplicateOfEntityId: matchId,
    notes: `Дубликат ${matchKind}: ${input.matchReason || ""}`,
  });
}

async function findDuplicateMatches(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  item: MergeableQueueItem,
): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];
  const phones = item.phone ?? [];
  const name = (item.business_name || item.title || item.person_name || "")
    .trim()
    .toLowerCase();

  if (phones.length) {
    const { data } = await supabase
      .from("businesses")
      .select("id, name, slug, phone, status")
      .in("phone", phones)
      .limit(8);
    for (const row of data ?? []) {
      matches.push({
        kind: "business",
        id: row.id,
        title: row.name,
        reason: `phone:${row.phone}`,
        slug: row.slug,
        businessStatus: row.status,
      });
    }
  }

  if (item.telegram_username) {
    const { data } = await supabase
      .from("import_review_items")
      .select(
        "id, title, telegram_username, review_status, published_entity_type, published_entity_id",
      )
      .eq("telegram_username", item.telegram_username)
      .neq("id", item.id)
      .eq("review_status", "approved")
      .limit(5);
    for (const row of data ?? []) {
      matches.push({
        kind: "import_item",
        id: row.id,
        title: row.title,
        reason: row.published_entity_id
          ? `telegram:@${item.telegram_username} → ${row.published_entity_type}`
          : `telegram:@${item.telegram_username}`,
      });
    }
  }

  if (item.telegram_user_id) {
    const { data } = await supabase
      .from("import_review_items")
      .select(
        "id, title, telegram_user_id, review_status, published_entity_type, published_entity_id",
      )
      .eq("telegram_user_id", item.telegram_user_id)
      .neq("id", item.id)
      .eq("review_status", "approved")
      .limit(5);
    for (const row of data ?? []) {
      matches.push({
        kind: "import_item",
        id: row.id,
        title: row.title,
        reason: `telegram_user_id:${item.telegram_user_id}`,
      });
    }
  }

  if (name.length >= 3) {
    const { data } = await supabase
      .from("businesses")
      .select("id, name, slug, status")
      .ilike("name", name)
      .limit(8);
    for (const row of data ?? []) {
      matches.push({
        kind: "business",
        id: row.id,
        title: row.name,
        reason: "normalized_name",
        slug: row.slug,
        businessStatus: row.status,
      });
    }
  }

  if (item.recurring_cluster_id) {
    const { data } = await supabase
      .from("import_review_items")
      .select("id, title, review_status")
      .eq("recurring_cluster_id", item.recurring_cluster_id)
      .neq("id", item.id)
      .eq("review_status", "approved")
      .limit(5);
    for (const row of data ?? []) {
      matches.push({
        kind: "import_item",
        id: row.id,
        title: row.title,
        reason: "recurring_cluster",
      });
    }
  }

  // Copies still sitting in the queue: reposts of the same ad and rows sharing
  // the advertiser's Telegram account or phone. Without these the scan reports
  // «совпадений нет» while eighty identical cards wait in the inbox.
  const twins = await findQueueTwins(
    untyped(supabase),
    item as unknown as MergeableQueueItem,
  );
  for (const twin of twins.slice(0, 30)) {
    matches.push({
      kind: "import_item",
      id: twin.row.id,
      title: twin.row.business_name || twin.row.title,
      reason: `в очереди · ${twin.reason}`,
    });
  }

  // de-dupe by kind+id; prefer live businesses over archived
  const seen = new Set<string>();
  const unique = matches.filter((m) => {
    const key = `${m.kind}:${m.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => {
    const aArch = a.kind === "business" && a.businessStatus === "archived" ? 1 : 0;
    const bArch = b.kind === "business" && b.businessStatus === "archived" ? 1 : 0;
    return aArch - bArch;
  });
  return unique;
}

export async function approveImportReviewItemAction(input: {
  id: string;
  force?: boolean;
}): Promise<ImportReviewActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const { data: row, error: loadError } = await supabase
    .from("import_review_items")
    .select("*")
    .eq("id", input.id)
    .maybeSingle();
  if (loadError) return fail(mapDbError(loadError));
  if (!row) return fail("Запись не найдена.");
  const item = row as unknown as ImportReviewItem;

  if (item.review_status === "approved" && item.published_entity_id) {
    return ok("Уже одобрено ранее — дубликат не создан.", {
      publishedEntityType: item.published_entity_type ?? undefined,
      publishedEntityId: item.published_entity_id,
    });
  }

  // Real estate is frozen: real_estate_listings does not exist yet, and the old
  // route dumped these into listings as marketplace_item (see PHASE_PLAN_V1 §3.3).
  if (
    item.entity_type === "real_estate" ||
    item.target_collection === "real_estate"
  ) {
    await supabase.rpc("admin_import_review_set_status", {
      p_item_id: input.id,
      p_status: "needs_more_info",
      p_notes: "RE table not ready. Wait for Phase 3.",
      p_reject_reason: null,
      p_duplicate_of_item_id: null,
      p_duplicate_of_entity_type: null,
      p_duplicate_of_entity_id: null,
    });
    revalidatePath("/admin/import-review");
    revalidatePath(`/admin/import-review/${input.id}`);
    return fail(
      "Real estate не публикуется: RE table not ready. Wait for Phase 3.",
    );
  }

  const resolvedName = resolveImportDisplayName({
    title: item.title,
    business_name: item.business_name,
    person_name: item.person_name,
    description: item.description || item.source_text,
    source_text: item.source_text,
    instagram: item.instagram,
  });
  const title = resolvedName.name;
  if (!title?.trim() || title === "Без названия") {
    return fail("Нужно название (title / business_name / person_name).");
  }
  if (!item.target_collection) {
    return fail("Укажите target_collection.");
  }
  if (!item.entity_type) {
    return fail("Укажите entity_type.");
  }

  // Resolve county before gate (USA Location Canon).
  const resolved = await resolveAndPersistImportLocation(supabase, item);
  if (!resolved.ok) {
    return fail(resolved.message);
  }
  const resolvedLoc = resolved.loc;

  // Publish gate — single source of truth lives in the DB
  // (import_review_publish_gate_errors, QUALITY_CARD_RULES_V1); the same
  // function backstops mark_approved and the service autopublish path.
  const { data: gateErrors, error: gateError } = await supabase.rpc(
    "import_review_publish_gate_check",
    { p_item_id: input.id },
  );
  if (gateError) return fail(mapDbError(gateError));
  if ((gateErrors ?? []).length > 0) {
    return fail(
      `Публикация заблокирована — не заполнено: ${(gateErrors ?? []).join("; ")}`,
    );
  }

  const hasContact =
    (item.phone?.length ?? 0) > 0 ||
    (item.whatsapp?.length ?? 0) > 0 ||
    (item.instagram?.length ?? 0) > 0 ||
    (item.website?.length ?? 0) > 0 ||
    (item.email?.length ?? 0) > 0 ||
    Boolean(item.telegram_username) ||
    Boolean(item.telegram_user_id) ||
    Boolean(item.source_url?.trim());
  if (!hasContact) {
    return fail(
      "Нужен хотя бы один контакт (телефон, соцсеть, Telegram ID или ссылка на пост).",
    );
  }

  const duplicates = await findDuplicateMatches(
    supabase,
    item as unknown as MergeableQueueItem,
  );
  if (duplicates.length > 0 && !input.force) {
    const withPreview = await attachMergePreviews(
      supabase,
      input.id,
      duplicates,
    );
    return fail(
      "Найдены возможные дубликаты. Проверьте совпадения или повторите с подтверждением.",
      withPreview,
    );
  }

  const collection = item.target_collection as ImportReviewTargetCollection;
  let publishedEntityType: string;
  let publishedEntityId: string;
  const loc = {
    city: resolvedLoc.city,
    region: resolvedLoc.region,
    stateCode: resolvedLoc.stateCode,
    countyGeoid: resolvedLoc.countyGeoid,
    locationSource: resolvedLoc.locationSource,
    locationConfidence: resolvedLoc.locationConfidence,
    postalCode: resolvedLoc.postalCode,
  };
  const streetAddress = item.address_line?.trim() || null;
  const postalCode = loc.postalCode?.trim() || item.postal_code?.trim() || null;
  const locationPrecision = streetAddress
    ? ("street" as const)
    : loc.region && !loc.city
      ? ("county" as const)
      : null;
  const cleanup = parseProfessionalCleanupPayload(item.raw_payload);

  // Professional Cleanup handoff: confirming as specialist keeps the existing
  // live Professional (no duplicate insert). Other targets create a new entity
  // and archive the linked Professional after success.
  if (cleanup && collection === "private_specialists") {
    const displayName = String(
      item.person_name?.trim() || title || "Специалист",
    ).trim();
    const patch: Record<string, unknown> = {
      display_name: displayName.slice(0, 120),
      short_description: (item.description ?? "").slice(0, 280) || null,
      description: item.description ?? item.source_text ?? null,
      city: loc.city,
      region: loc.region,
      state_code: loc.stateCode || "US-CA",
      county_geoid: loc.countyGeoid,
      location_source: loc.locationSource,
      location_confidence: loc.locationConfidence,
      location_precision: locationPrecision,
      private_address_line: streetAddress,
      postal_code: postalCode,
      phone: item.phone?.[0] ?? null,
      payment_methods: item.payment_methods || [],
      email: item.email?.[0] ?? null,
      website: item.website?.[0] ?? null,
      instagram_url: item.instagram?.[0]
        ? `https://instagram.com/${item.instagram[0].replace(/^@/, "")}`
        : null,
      telegram_url: item.telegram_username
        ? `https://t.me/${item.telegram_username.replace(/^@/, "")}`
        : null,
      updated_at: new Date().toISOString(),
      import_batch_id: "import_review_cleanup_confirm",
      status: "approved",
      visibility: "public",
    };
    const { error: updateError } = await untyped(supabase)
      .from("professionals")
      .update(patch)
      .eq("id", cleanup.existing_professional_id);
    if (updateError) {
      return fail(
        updateError.message || "Не удалось обновить существующий Professional.",
      );
    }
    publishedEntityType = "professional";
    publishedEntityId = cleanup.existing_professional_id;

    await addMissingProfessionalServices(
      supabase,
      publishedEntityId,
      offersFromQueueItem(item),
    );
    await addMissingEntityPromotions(
      supabase,
      "professional",
      publishedEntityId,
      promotionsFromQueueItem(item),
    );
    await addMissingEntityUpdates(
      supabase,
      "professional",
      publishedEntityId,
      updatesFromQueueItem(item),
      { source: "import" },
    );

    const { error: markError } = await supabase.rpc(
      "admin_import_review_mark_approved",
      {
        p_item_id: input.id,
        p_published_entity_type: publishedEntityType,
        p_published_entity_id: publishedEntityId,
      },
    );
    if (markError) return fail(mapDbError(markError));

    revalidatePath("/admin/import-review");
    revalidatePath(`/admin/import-review/${input.id}`);
    revalidatePath("/admin");
    await runSettledRetention({
      itemId: input.id,
      previewImageUrl: item.preview_image_url,
      publishedEntityType,
      publishedEntityId,
    });
    return ok("Подтверждено как Professional (существующая запись).", {
      publishedEntityType,
      publishedEntityId,
    });
  }

  if (collection === "private_specialists") {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fail("Нужно войти в аккаунт.");

    const displayName = String(
      item.person_name?.trim() || title || "Специалист",
    ).trim();
    const slug = slugify(displayName);
    const sourceUrl = item.source_url?.trim() || null;
    const sourceType = sourceTypeFromKind(
      resolveSourceKind(sourceUrl, item.source),
    );
    const { data: inserted, error: insertError } = await untyped(supabase)
      .from("professionals")
      .insert({
        owner_profile_id: null,
        created_by_profile_id: user.id,
        source_type: sourceType,
        source_record_id: item.id,
        source_url: sourceUrl,
        imported_at: new Date().toISOString(),
        import_batch_id: "import_review_approve",
        display_name: displayName.slice(0, 120),
        slug,
        short_description: (item.description ?? "").slice(0, 280) || null,
        description: item.description ?? item.source_text ?? null,
        status: "approved",
        visibility: "public",
        city: loc.city,
        region: loc.region,
        state_code: loc.stateCode || "US-CA",
        county_geoid: loc.countyGeoid,
        location_source: loc.locationSource,
        location_confidence: loc.locationConfidence,
        location_precision: locationPrecision,
        // Shared workplace street is OK — store privately for specialists.
        private_address_line: streetAddress,
        postal_code: postalCode,
        // Area-only pins unless we have a street (still not auto-geocoded here).
        latitude: null,
        longitude: null,
        public_exact_address: false,
        phone: item.phone?.[0] ?? null,
        payment_methods: item.payment_methods || [],
        email: item.email?.[0] ?? null,
        website: item.website?.[0] ?? null,
        instagram_url: item.instagram?.[0]
          ? `https://instagram.com/${item.instagram[0].replace(/^@/, "")}`
          : null,
        published_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      return fail(insertError?.message || "Не удалось создать professional.");
    }
    publishedEntityType = "professional";
    publishedEntityId = (inserted as { id: string }).id;

    await addMissingProfessionalServices(
      supabase,
      publishedEntityId,
      offersFromQueueItem(item),
    );
    await addMissingEntityPromotions(
      supabase,
      "professional",
      publishedEntityId,
      promotionsFromQueueItem(item),
    );
    await addMissingEntityUpdates(
      supabase,
      "professional",
      publishedEntityId,
      updatesFromQueueItem(item),
      { source: "import" },
    );
  } else if (
    collection === "businesses" ||
    collection === "services" ||
    collection === "organizations"
  ) {
    const phone = item.phone?.[0] ?? null;
    const website = item.website?.[0] ?? null;
    const slug = slugify(String(title));
    const { data: businessId, error: upsertError } = await supabase.rpc(
      "admin_upsert_business",
      {
        p_id: null,
        p_name: String(title).trim(),
        p_slug: slug,
        p_short_description: (item.description ?? "").slice(0, 240) || null,
        p_description: item.description ?? null,
        p_phone: phone,
        p_website: website,
        p_city: loc.city ?? "",
        p_address_line: streetAddress,
        p_status: "approved",
        p_category_id: null,
      },
    );
    if (upsertError) return fail(mapDbError(upsertError));
    publishedEntityType = "business";
    publishedEntityId = businessId as string;

    const sourceUrl = item.source_url?.trim() || null;
    const sourceKind = resolveSourceKind(sourceUrl, item.source);
    const telegramUsername = item.telegram_username?.replace(/^@/, "").trim();
    const businessPrecision = inferLocationPrecision({
      addressLine: null,
      city: loc.city,
      region: loc.region,
    });
    const extras: {
      source_url: string | null;
      source_kind: "telegram" | "facebook" | "directory" | "platform" | null;
      instagram_url?: string;
      telegram_url?: string | null;
      city?: string | null;
      region?: string | null;
      state_code?: string | null;
      county_geoid?: string | null;
      location_source?: string | null;
      location_confidence?: string | null;
      location_precision?: "street" | "county" | null;
      latitude?: number | null;
      longitude?: number | null;
      google_maps_url?: string;
      payment_methods?: string[];
    } = {
      source_url: sourceUrl,
      source_kind: sourceKind,
      city: loc.city,
      region: loc.region,
      state_code: loc.stateCode || "US-CA",
      county_geoid: loc.countyGeoid,
      location_source: loc.locationSource,
      location_confidence: loc.locationConfidence,
      // Business map pins require street; county/city stay off the map.
      location_precision: businessPrecision === "county" ? "county" : null,
      latitude: null,
      longitude: null,
      payment_methods: item.payment_methods || [],
    };
    // Street address on the card → geocode now, so the published card opens
    // with a pin instead of waiting for a later enrich pass.
    if (streetAddress) {
      const geo = await geocodeStreetAddress({
        addressLine: streetAddress,
        city: loc.city,
        stateCode: loc.stateCode,
        postalCode,
      });
      if (geo) {
        extras.latitude = geo.latitude;
        extras.longitude = geo.longitude;
        extras.location_precision = "street";
        extras.google_maps_url = googleMapsUrlForAddress(
          streetAddress,
          loc.city,
          loc.stateCode,
        );
      }
    }
    if (item.instagram?.[0]) {
      extras.instagram_url = `https://instagram.com/${item.instagram[0].replace(/^@/, "")}`;
    }
    if (telegramUsername) {
      extras.telegram_url = `https://t.me/${telegramUsername}`;
    }
    await untyped(supabase).from("businesses").update(extras).eq("id", publishedEntityId);
    await addMissingBusinessOffers(
      supabase,
      publishedEntityId,
      offersFromQueueItem(item),
    );
    await addMissingEntityPromotions(
      supabase,
      "business",
      publishedEntityId,
      promotionsFromQueueItem(item),
    );
    await addMissingEntityUpdates(
      supabase,
      "business",
      publishedEntityId,
      updatesFromQueueItem(item),
      { source: "import" },
    );
  } else if (collection === "jobs") {
    // Jobs live in the jobs table only (V-8: the old route into listings made
    // queue-published jobs invisible on /jobs, which reads the jobs table).
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fail("Нужно войти в аккаунт.");

    const jobSlug = `${slugify(String(title))}-${input.id.slice(0, 8)}`.slice(
      0,
      80,
    );
    const { data: inserted, error: insertError } = await untyped(supabase)
      .from("jobs")
      .insert({
        // D1: imported jobs are unowned-until-claimed; the admin is recorded
        // as creator/importer only (P-1, ARCHITECTURE_ALIGNMENT_ROADMAP).
        owner_profile_id: null,
        created_by_profile_id: user.id,
        title: String(title).trim().slice(0, 200),
        slug: jobSlug,
        description: item.description ?? item.source_text ?? null,
        city: loc.city ?? item.city,
        state_code: loc.stateCode ?? null,
        county_geoid: loc.countyGeoid,
        location_source: loc.locationSource,
        location_confidence: loc.locationConfidence,
        postal_code: postalCode,
        status: "published",
        visibility: "public",
        source_type: sourceTypeFromKind(
          resolveSourceKind(item.source_url, item.source),
        ),
        source_url: item.source_url?.trim() || null,
        payment_methods: item.payment_methods || [],
        imported_at: new Date().toISOString(),
        imported_by_profile_id: user.id,
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      return fail(insertError?.message || "Не удалось создать job.");
    }
    publishedEntityType = "job";
    publishedEntityId = (inserted as { id: string }).id;
  } else if (
    collection === "marketplace" ||
    collection === "real_estate" ||
    collection === "lechu" ||
    collection === "transfers"
  ) {
    // Create as draft listing owned by approving admin — then activate via admin_set_listing_status.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fail("Нужно войти в аккаунт.");

    const listingType =
      collection === "lechu"
        ? "transport_carry"
        : collection === "transfers"
          ? "transfer"
          : "marketplace_item";

    const { data: inserted, error: insertError } = await untyped(supabase)
      .from("listings")
      .insert({
        // D1: imported listings are unowned-until-claimed (RLS allows null owner).
        owner_id: null,
        listing_type: listingType,
        status: "draft",
        visibility: "unlisted",
        title: String(title).trim(),
        description: item.description ?? item.source_text ?? "",
        price_amount: item.price,
        price_currency: item.currency ?? "USD",
        city: loc.city ?? item.city,
        state: loc.region || loc.stateCode?.replace(/^US-/, "") || item.state,
        state_code: loc.stateCode ?? null,
        county_geoid: loc.countyGeoid,
        location_source: loc.locationSource,
        location_confidence: loc.locationConfidence,
        postal_code: postalCode,
        publisher_type: "profile",
        source_url: item.source_url?.trim() || null,
        source_kind: resolveSourceKind(item.source_url, item.source),
        payment_methods: item.payment_methods || [],
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      return fail(insertError?.message || "Не удалось создать listing.");
    }

    if (listingType === "marketplace_item") {
      await supabase.from("marketplace_listing_details").upsert({
        listing_id: inserted.id,
        condition: "good",
        transaction_type: "sell",
      });
    }

    const { error: statusError } = await supabase.rpc(
      "admin_set_listing_status",
      {
        p_listing_id: inserted.id,
        p_status: "active",
        p_reason: "import_review_approved",
      },
    );
    if (statusError) {
      // Keep draft listing linked even if activate fails
      publishedEntityType = "listing";
      publishedEntityId = inserted.id;
      await supabase.rpc("admin_import_review_mark_approved", {
        p_item_id: input.id,
        p_published_entity_type: publishedEntityType,
        p_published_entity_id: publishedEntityId,
      });
      await runSettledRetention({
        itemId: input.id,
        previewImageUrl: item.preview_image_url,
        publishedEntityType,
        publishedEntityId,
      });
      return fail(
        `Listing создан как draft, активация не удалась: ${statusError.message}`,
        duplicates,
      );
    }

    publishedEntityType = "listing";
    publishedEntityId = inserted.id;
  } else if (collection === "events") {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fail("Нужно войти в аккаунт.");

    const eventTitle = String(title).trim();
    const blob = [item.description, item.source_text, item.title]
      .filter((x): x is string => Boolean(x?.trim()))
      .join("\n");
    const structured = structureEventFromText(blob);
    const raw =
      item.raw_payload && typeof item.raw_payload === "object"
        ? (item.raw_payload as Record<string, unknown>)
        : {};
    const stored =
      raw.event_structure && typeof raw.event_structure === "object"
        ? (raw.event_structure as Record<string, unknown>)
        : {};

    const eventAtLabel =
      (typeof stored.event_at_label === "string" && stored.event_at_label.trim()) ||
      structured.eventAtLabel ||
      null;
    const startsAt =
      (typeof stored.starts_at === "string" && stored.starts_at.trim()) ||
      structured.startsAt ||
      null;
    const priceLabel =
      (typeof stored.price_label === "string" && stored.price_label.trim()) ||
      structured.priceLabel ||
      (item.price != null
        ? `${item.currency ?? "USD"} ${item.price}`.trim()
        : null);
    const paymentNote = item.review_notes?.match(
      /(?:^|\s)payment:\s*([^|\n\[]+)/i,
    )?.[1];
    const notedPaymentMethods = (paymentNote || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const paymentMethods = [
      ...(Array.isArray(stored.payment_methods)
        ? (stored.payment_methods as unknown[])
            .map((x) => String(x || "").trim())
            .filter(Boolean)
        : []),
            ...(item.payment_methods || []),
      ...structured.paymentMethods,
      ...notedPaymentMethods,
    ].filter((method, index, all) => all.indexOf(method) === index);
    const registrationUrl =
      (typeof stored.registration_url === "string" &&
        stored.registration_url.trim()) ||
      structured.registrationUrl ||
      item.website?.[0]?.trim() ||
      null;
    const addressLine =
      item.address_line?.trim() || structured.addressLine || null;
    const city = item.city?.trim() || structured.city || null;
    const phone =
      item.phone?.[0]?.trim() || structured.phone || null;
    const description =
      structured.description ||
      item.description ||
      null;
    const venueName =
      (typeof stored.venue_name === "string" && stored.venue_name.trim()) ||
      null;
    const category =
      (typeof stored.category === "string" && stored.category.trim()) || null;
    let sourceLanguage =
      (typeof stored.source_language === "string" &&
        stored.source_language.trim()) ||
      null;
    let titleOriginal =
      (typeof stored.title_original === "string" &&
        stored.title_original.trim()) ||
      null;
    let descriptionOriginal =
      (typeof stored.description_original === "string" &&
        stored.description_original.trim()) ||
      null;

    let publishedTitle = eventTitle;
    let publishedDescription = description;

    // English (or mostly-Latin) affiches → Russian copy for the public card;
    // keep the author's original behind «Показать оригинал».
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
        // Publish without translation if the LLM path fails — moderators can retry.
      }
    }

    // One affiche can announce several dates — each date is its own event.
    const sessions = structured.occurrences.length
      ? structured.occurrences
      : [{ label: eventAtLabel ?? "", startsAt }];

    const rows = sessions.map((session, index) => ({
      owner_profile_id: user.id,
      title: publishedTitle.slice(0, 200),
      slug: index === 0 ? slugify(publishedTitle) : `${slugify(publishedTitle)}-${index + 1}`,
      description: publishedDescription,
      status: "published",
      starts_at: session.startsAt ?? startsAt,
      event_at_label: session.label || eventAtLabel,
      city: loc.city ?? city,
      state_code: loc.stateCode || "US-CA",
      county_geoid: loc.countyGeoid,
      location_source: loc.locationSource,
      location_confidence: loc.locationConfidence,
      postal_code: postalCode,
      address_line: addressLine,
      venue_name: venueName,
      phone,
      price_label: priceLabel,
      payment_methods: paymentMethods.length ? paymentMethods : [],
      category,
      source_language: sourceLanguage,
      title_original: titleOriginal,
      description_original: descriptionOriginal,
      registration_url: registrationUrl,
      source_url: item.source_url?.trim() || null,
      source_channel: resolveSourceKind(item.source_url, item.source),
      // Dedupe key with external_id — stays the raw queue source, not provenance.
      external_source: item.source?.split(":")[0] || "telegram",
      source_body: item.source_text ?? item.description ?? null,
      format: "offline",
    }));

    const { data: inserted, error: insertError } = await untyped(supabase)
      .from("events")
      .insert(rows)
      .select("id");
    if (insertError || !inserted?.length) {
      return fail(insertError?.message || "Не удалось создать event.");
    }
    publishedEntityType = "event";
    publishedEntityId = (inserted as { id: string }[])[0]!.id;
  } else {
    return fail(`Неизвестная коллекция: ${collection}`);
  }

  const { error: markError } = await supabase.rpc(
    "admin_import_review_mark_approved",
    {
      p_item_id: input.id,
      p_published_entity_type: publishedEntityType,
      p_published_entity_id: publishedEntityId,
    },
  );
  if (markError) return fail(mapDbError(markError));

  if (cleanup && collection !== "private_specialists") {
    await archiveLinkedCleanupProfessional(supabase, cleanup);
  }

  await runSettledRetention({
    itemId: input.id,
    previewImageUrl: item.preview_image_url,
    publishedEntityType,
    publishedEntityId,
  });

  revalidatePath("/admin/import-review");
  revalidatePath(`/admin/import-review/${input.id}`);
  revalidatePath("/admin/businesses");
  revalidatePath("/admin/listings");
  revalidatePath("/admin");
  return ok(
    cleanup
      ? "Одобрено: создана новая сущность, связанный Professional архивирован."
      : "Одобрено и создана рабочая запись.",
    {
      publishedEntityType,
      publishedEntityId,
    },
  );
}
