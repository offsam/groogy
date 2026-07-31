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
import {
  evaluateThinProfessionalPublish,
  normalizePersonName,
} from "@/lib/professional/thin-card-policy";
import { resolveImportDisplayName } from "@/lib/import-review/display-name";
import {
  hasRealBusinessPhoto,
  isWeakIdentityName,
  preferRicherIdentityName,
  preferRicherImage,
} from "@/lib/import-review/field-richness";
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
import { isNewsUpdateTitle } from "@/lib/updates/extract";
import type { QueuePromotion } from "@/types/promotion";
import type { QueueUpdate } from "@/types/update";
import {
  narrativeWithContactPointer,
  shortNarrativeTeaser,
} from "@/lib/content/structure-business-profile";
import { isSharedNonIdentityHost } from "@/lib/import-review/shared-hosts";
import { isPlatformSaasHost } from "@/lib/import-review/platform-saas-hosts";
import {
  parseProfessionalCleanupPayload,
  type ProfessionalCleanupPayload,
} from "@/lib/import-review/professional-cleanup";
import { afterImportReviewSettledRetention } from "@/lib/import-review/retention";
import { liveEntityHref } from "@/lib/import-review/live-entity-href";
import {
  buildMergePatch,
  findQueueTwins,
  mergeQueueItems,
  sortByStrength,
  MERGE_SELECT,
  type MergeableQueueItem,
} from "@/lib/import-review/merge-queue-items";
import { findMatchingRecommendations } from "@/lib/import-review/find-matching-recommendations";
import { confirmRecommendationMergeAction } from "@/lib/import-review/recommendation-actions";
import { structureEventFromText, titleFromOccurrenceLabel } from "@/lib/events/structure-event-from-text";
import type {
  ImportReviewEntityType,
  ImportReviewItem,
  ImportReviewStatus,
  ImportReviewTargetCollection,
} from "@/types/import-review";

/** Untyped access until generated Database types include professionals/events. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic PostgREST tables
function untyped(client: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      /** After merge into a live card — open the rich profile, not the poor queue row. */
      liveHref?: string;
      duplicates?: DuplicateMatch[];
      /** What «Объединить все» would do across queue copies + recommendations. */
      mergeAllPreview?: MergeAllPreview;
    }
  | {
      ok: false;
      message: string;
      duplicates?: DuplicateMatch[];
      mergeAllPreview?: MergeAllPreview;
    };

export type DuplicateMatch = {
  kind: "business" | "professional" | "listing" | "import_item" | "recommendation";
  id: string;
  title: string | null;
  reason: string;
  slug?: string | null;
  /** Live business/professional status when kind=business|professional */
  businessStatus?: string | null;
  /**
   * Open queue twin that «Объединить все» / «Свернуть копии» can fold.
   * Approved historical imports stay import_item but are not queue copies.
   */
  queueOpen?: boolean;
  /** When approved import already points at a live card. */
  publishedEntityType?: string | null;
  publishedEntityId?: string | null;
  /** Recommendation mention counters (kind=recommendation). */
  mentionCount?: number;
  thirdPartyMentions?: number;
  selfAdMentions?: number;
  /** Short source text for recommendation matches. */
  snippet?: string | null;
  /** What merge into this match would do (fill-empty preview). */
  mergePreview?: MergePreview;
};

export type MergePreview = {
  summary: string;
  willAdd: string[];
  willSkip: string[];
  queueEffect: string;
};

/** Counts shown under «Объединить все». */
export type MergeAllPreview = MergePreview & {
  queueCopies: number;
  recommendations: number;
  catalogHits: number;
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
    if (isPlatformSaasHost(host) || isPlatformSaasHost(t)) continue;
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
  // R13: news / office-move blurbs never become services.
  return merged.filter(
    (o) =>
      !isNewsUpdateTitle(o.title) &&
      !isNewsUpdateTitle(o.description || ""),
  );
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
      "phone, email, website, instagram, city, state, description, source_text, preview_image_url, title, business_name, person_name, services",
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
  // Category SVGs do not count as a real photo.
  check(
    "фото",
    qImage,
    hasRealBusinessPhoto(String(biz.image_url || "")) ? biz.image_url : null,
  );

  const qName =
    preferRicherIdentityName(
      null,
      (item.business_name as string | null) ||
        (item.person_name as string | null) ||
        (item.title as string | null),
    ) || null;
  if (qName && isWeakIdentityName(String(biz.name || ""))) {
    willAdd.push(`название: ${qName.slice(0, 80)}`);
  } else if (qName && String(biz.name || "").trim()) {
    willSkip.push("название уже есть");
  } else {
    check("название", qName, biz.name);
  }

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
    willAdd.unshift("статус: из архива → pending (только админка, не в открытый доступ)");
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
      ? `Бизнес вернём из архива как pending (не публикуем) и привяжем очередь к «${name}»`
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

  // Neither row is published: describe the fold — which card survives and what
  // it gains. Nothing is overwritten, so «Не тронет» stays empty by design.
  const { data: rowsRaw } = await untyped(supabase)
    .from("import_review_items")
    .select(MERGE_SELECT)
    .in("id", [sourceItemId, targetItemId]);
  const rows = (rowsRaw ?? []) as unknown as MergeableQueueItem[];
  const mergeable = rows.filter((row) => !row.published_entity_id);
  if (mergeable.length === 2) {
    const [strong, ...weak] = sortByStrength(mergeable);
    const { changed } = buildMergePatch(strong, weak);
    const survivor =
      strong.business_name || strong.title || strong.person_name || strong.id;
    const stays = strong.id === sourceItemId;
    return {
      summary: `Копии свернём в «${survivor}»${stays ? " (эта карточка)" : " (карточка совпадения)"} — заполненное не перезаписываем`,
      willAdd: changed.length
        ? [`дополним поля: ${changed.join(", ")}`]
        : ["новых данных нет — только счётчик повторов"],
      willSkip: [],
      queueEffect: stays
        ? "Очередь: совпадение закроется как дубль этой карточки"
        : "Очередь: эта карточка закроется как дубль совпадения, данные перенесём",
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
  for (const m of matches.slice(0, 24)) {
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
    } else if (m.kind === "professional") {
      out.push({
        ...m,
        mergePreview: {
          summary: `Влить в специалиста «${m.title || m.id}» (fill-empty, без авто-публикации)`,
          willAdd: ["пустые контакты / описание / фото с очереди"],
          willSkip: ["непустые поля специалиста не затираются"],
          queueEffect:
            "Очередь → approved + published_entity=professional; каталог не публикуется сам",
        },
      });
    } else if (m.kind === "recommendation") {
      const mentions = m.mentionCount ?? 1;
      const parts = [
        m.thirdPartyMentions
          ? `чужие ×${m.thirdPartyMentions}`
          : null,
        m.selfAdMentions ? `сами ×${m.selfAdMentions}` : null,
      ].filter(Boolean);
      out.push({
        ...m,
        mergePreview: {
          summary: `Привяжем рекомендацию «${m.title || m.id}» к опубликованной карточке этой записи`,
          willAdd: [
            `счётчик рекомендаций +${mentions}${
              parts.length ? ` (${parts.join(", ")})` : ""
            }`,
            ...(m.snippet ? [`текст: ${m.snippet}`] : []),
          ],
          willSkip: [],
          queueEffect:
            "Рекомендация: status=merged → live business/professional",
        },
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

/** Preview for folding this card with every queue match + recommendations. */
async function buildMergeAllPreview(
  supabase: SupabaseClient,
  itemId: string,
  matches: DuplicateMatch[],
): Promise<MergeAllPreview | undefined> {
  const queueIds = matches
    .filter((m) => m.kind === "import_item" && m.queueOpen)
    .map((m) => m.id);
  const businessMatches = matches.filter((m) => m.kind === "business");
  const professionalMatches = matches.filter((m) => m.kind === "professional");
  const approvedToBusiness = matches.filter(
    (m) =>
      m.kind === "import_item" &&
      !m.queueOpen &&
      m.publishedEntityType === "business" &&
      m.publishedEntityId,
  );
  const approvedToProfessional = matches.filter(
    (m) =>
      m.kind === "import_item" &&
      !m.queueOpen &&
      m.publishedEntityType === "professional" &&
      m.publishedEntityId,
  );
  const catalogBusinessCount = new Set([
    ...businessMatches.map((m) => m.id),
    ...approvedToBusiness.map((m) => m.publishedEntityId!),
  ]).size;
  const catalogProfessionalCount = new Set([
    ...professionalMatches.map((m) => m.id),
    ...approvedToProfessional.map((m) => m.publishedEntityId!),
  ]).size;
  const otherCatalogHits = matches.filter((m) => m.kind === "listing").length;
  const recs = matches.filter((m) => m.kind === "recommendation");
  const catalogHits =
    catalogBusinessCount + catalogProfessionalCount + otherCatalogHits;
  if (
    queueIds.length +
      recs.length +
      catalogBusinessCount +
      catalogProfessionalCount <
    1
  ) {
    return undefined;
  }

  let queuePreview: MergePreview | null = null;
  if (queueIds.length >= 1) {
    const ids = Array.from(new Set([itemId, ...queueIds])).filter(Boolean);
    if (ids.length >= 2) {
      const { data: rowsRaw } = await untyped(supabase)
        .from("import_review_items")
        .select(MERGE_SELECT)
        .in("id", ids);
      const rows = ((rowsRaw ?? []) as unknown as MergeableQueueItem[]).filter(
        (row) => !row.published_entity_id,
      );
      if (rows.length >= 2) {
        const [strong, ...weak] = sortByStrength(rows);
        const { changed } = buildMergePatch(strong, weak);
        const survivor =
          strong.business_name ||
          strong.title ||
          strong.person_name ||
          strong.id;
        const folded = weak
          .map(
            (row) =>
              row.business_name ||
              row.title ||
              row.person_name ||
              row.id.slice(0, 8),
          )
          .slice(0, 6);
        queuePreview = {
          summary: `Свернём ${weak.length} ${
            weak.length === 1 ? "копию" : "копий"
          } в «${survivor}» — заполненное не перезаписываем`,
          willAdd: changed.length
            ? [`дополним поля: ${changed.join(", ")}`]
            : ["новых данных нет — только счётчик повторов"],
          willSkip: [],
          queueEffect: `Закроем как дубли: ${folded.join(", ")}${
            weak.length > folded.length ? "…" : ""
          }`,
        };
      }
    }
  }

  const recMentions = recs.reduce(
    (sum, r) => sum + Math.max(r.mentionCount ?? 1, 1),
    0,
  );
  const primaryBiz =
    businessMatches.find((m) => m.businessStatus === "archived") ||
    businessMatches[0] ||
    approvedToBusiness[0] ||
    null;
  const parts: string[] = [];
  if (queueIds.length) parts.push(`копий в очереди: ${queueIds.length}`);
  if (catalogBusinessCount) {
    parts.push(
      `в каталог: ${catalogBusinessCount}${
        primaryBiz?.title ? ` («${primaryBiz.title}»)` : ""
      }`,
    );
  }
  if (recs.length) {
    parts.push(
      `рекомендаций: ${recs.length}${
        recMentions > recs.length ? ` (упоминаний ~${recMentions})` : ""
      }`,
    );
  }
  if (otherCatalogHits) {
    parts.push(`прочее вручную: ${otherCatalogHits}`);
  }

  const willAdd = [
    ...(queuePreview?.willAdd ?? []),
    ...(primaryBiz
      ? [
          `вольём в «${primaryBiz.title || primaryBiz.id}»${
            primaryBiz.businessStatus === "archived"
              ? " (из архива → pending, без публикации)"
              : ""
          }`,
        ]
      : []),
    ...(recs.length
      ? [
          catalogBusinessCount || queueIds.length
            ? `затем привяжем ${recs.length} ${
                recs.length === 1 ? "рекомендацию" : "рекомендаций"
              } → +${recMentions}`
            : `привяжем ${recs.length} ${
                recs.length === 1 ? "рекомендацию" : "рекомендаций"
              } (нужна опубликованная карточка)`,
        ]
      : []),
  ];

  return {
    summary:
      parts.length > 0
        ? `Объединить всё: ${parts.join(" · ")}`
        : "Нечего объединять",
    willAdd,
    willSkip: otherCatalogHits
      ? ["Листинги / импорты без live-бизнеса — по одному"]
      : [],
    queueEffect: primaryBiz
      ? `Сначала каталог «${primaryBiz.title || primaryBiz.id}», потом рекомендации`
      : queuePreview?.queueEffect ||
        (recs.length
          ? "Рекомендации привяжутся только после публикации карточки"
          : ""),
    queueCopies: queueIds.length,
    recommendations: recs.length,
    catalogHits,
  };
}

function fail(
  message: string,
  duplicates?: DuplicateMatch[],
  mergeAllPreview?: MergeAllPreview,
): ImportReviewActionResult {
  return { ok: false, message, duplicates, mergeAllPreview };
}

function ok(
  message?: string,
  extra?: {
    id?: string;
    publishedEntityType?: string;
    publishedEntityId?: string;
    liveHref?: string;
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
    const linkedName =
      item.published_entity_type && item.published_entity_id
        ? ` Уже влита в ${item.published_entity_type} ${String(item.published_entity_id).slice(0, 8)}…`
        : "";
    return ok(
      linkedName
        ? `Новых двойников нет.${linkedName}`
        : "Совпадений не найдено.",
    );
  }
  const withPreview = await attachMergePreviews(supabase, input.id, duplicates);
  const mergeAllPreview = await buildMergeAllPreview(
    supabase,
    input.id,
    withPreview,
  );
  return fail(
    `Найдено совпадений: ${withPreview.length}. Проверьте и объедините или одобрите как новую.`,
    withPreview,
    mergeAllPreview,
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
 * Fold the card together with every queue match the moderator sees, merge into
 * a catalog business when present, then attach recommendations to the live card.
 */
export async function mergeQueueItemsAction(input: {
  id: string;
  matchIds: string[];
  recommendationIds?: string[];
  /** Catalog business ids from duplicate scan (phone / name hits). */
  businessIds?: string[];
  /** Catalog professional ids from duplicate scan. */
  professionalIds?: string[];
  /**
   * Approved import rows that already point at a live business — used to
   * resolve the same catalog target as the business list.
   */
  approvedImportIds?: string[];
}): Promise<ImportReviewActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const queueIds = Array.from(
    new Set([input.id, ...input.matchIds.map((id) => (id || "").trim())]),
  ).filter(Boolean);
  const recommendationIds = Array.from(
    new Set((input.recommendationIds ?? []).map((id) => (id || "").trim())),
  ).filter(Boolean);
  const businessIds = Array.from(
    new Set((input.businessIds ?? []).map((id) => (id || "").trim())),
  ).filter(Boolean);
  const professionalIds = Array.from(
    new Set((input.professionalIds ?? []).map((id) => (id || "").trim())),
  ).filter(Boolean);
  const approvedImportIds = Array.from(
    new Set((input.approvedImportIds ?? []).map((id) => (id || "").trim())),
  ).filter(Boolean);

  if (
    queueIds.length < 2 &&
    recommendationIds.length === 0 &&
    businessIds.length === 0 &&
    professionalIds.length === 0 &&
    approvedImportIds.length === 0
  ) {
    return fail("Нечего объединять.");
  }

  try {
    let survivorId = input.id;
    let survivorTitle: string | null = null;
    let mergedCount = 0;
    let changed: string[] = [];
    let catalogMerged = false;
    let catalogName: string | null = null;

    if (queueIds.length >= 2) {
      const merged = await mergeQueueItems(untyped(supabase), queueIds);
      if (merged) {
        survivorId = merged.survivorId;
        survivorTitle = merged.survivorTitle;
        mergedCount = merged.mergedCount;
        changed = merged.changed;
      }
    }

    // Resolve catalog business targets (direct hits + approved imports → business).
    const catalogTargetIds = new Set(businessIds);
    const catalogProfessionalIds = new Set(professionalIds);
    if (approvedImportIds.length) {
      const { data: approvedRows } = await untyped(supabase)
        .from("import_review_items")
        .select("id, published_entity_type, published_entity_id, title")
        .in("id", approvedImportIds);
      for (const row of approvedRows ?? []) {
        if (
          row.published_entity_type === "business" &&
          row.published_entity_id
        ) {
          catalogTargetIds.add(String(row.published_entity_id));
        }
        if (
          row.published_entity_type === "professional" &&
          row.published_entity_id
        ) {
          catalogProfessionalIds.add(String(row.published_entity_id));
        }
      }
    }

    if (catalogTargetIds.size > 0) {
      let catalog: ReturnType<typeof createServiceRoleClient>;
      try {
        catalog = createServiceRoleClient();
      } catch (err) {
        return fail(
          err instanceof Error
            ? err.message
            : "Нет service role — объединение с каталогом недоступно.",
        );
      }
      const { data: bizRows } = await untyped(catalog)
        .from("businesses")
        .select("id, name, slug, status, phone")
        .in("id", [...catalogTargetIds]);
      const businesses = (bizRows ?? []) as {
        id: string;
        name: string | null;
        slug: string | null;
        status: string;
        phone: string | null;
      }[];
      if (businesses.length) {
        // Prefer a live public card. Archived is last resort and stays pending
        // after merge (no auto-publish to the open catalog).
        const pick =
          businesses.find((b) => b.status === "approved" && b.phone) ||
          businesses.find((b) => b.status === "approved") ||
          businesses.find((b) => b.status === "pending" && b.phone) ||
          businesses.find((b) => b.status === "pending") ||
          businesses.find((b) => b.status === "archived" && b.phone) ||
          businesses.find((b) => b.status === "archived") ||
          businesses[0]!;

        const into = await mergeImportReviewIntoExistingAction({
          id: survivorId,
          matchKind: "business",
          matchId: pick.id,
          matchTitle: pick.name,
          matchReason: "merge_all_catalog",
          matchSlug: pick.slug,
        });
        if (!into.ok) {
          return fail(
            into.message ||
              `Не удалось влить в каталог «${pick.name || pick.id}»`,
          );
        }
        catalogMerged = true;
        catalogName = pick.name;
        survivorId = into.id || survivorId;
        survivorTitle = pick.name || survivorTitle;
      }
    }

    if (!catalogMerged && catalogProfessionalIds.size > 0) {
      let catalog: ReturnType<typeof createServiceRoleClient>;
      try {
        catalog = createServiceRoleClient();
      } catch (err) {
        return fail(
          err instanceof Error
            ? err.message
            : "Нет service role — объединение с каталогом недоступно.",
        );
      }
      const { data: proRows } = await untyped(catalog)
        .from("professionals")
        .select("id, display_name, slug, status, phone")
        .in("id", [...catalogProfessionalIds]);
      const professionals = (proRows ?? []) as {
        id: string;
        display_name: string | null;
        slug: string | null;
        status: string;
        phone: string | null;
      }[];
      if (professionals.length) {
        const pick =
          professionals.find((b) => b.status === "approved" && b.phone) ||
          professionals.find((b) => b.status === "approved") ||
          professionals.find((b) => b.status === "pending" && b.phone) ||
          professionals.find((b) => b.status === "pending") ||
          professionals.find((b) => b.status === "archived" && b.phone) ||
          professionals.find((b) => b.status === "archived") ||
          professionals[0]!;

        const into = await mergeImportReviewIntoExistingAction({
          id: survivorId,
          matchKind: "professional",
          matchId: pick.id,
          matchTitle: pick.display_name,
          matchReason: "merge_all_catalog",
          matchSlug: pick.slug,
        });
        if (!into.ok) {
          return fail(
            into.message ||
              `Не удалось влить в специалиста «${pick.display_name || pick.id}»`,
          );
        }
        catalogMerged = true;
        catalogName = pick.display_name;
        survivorId = into.id || survivorId;
        survivorTitle = pick.display_name || survivorTitle;
      }
    }

    const { data: survivor } = await untyped(supabase)
      .from("import_review_items")
      .select(
        "id, title, business_name, person_name, published_entity_type, published_entity_id",
      )
      .eq("id", survivorId)
      .maybeSingle();
    survivorTitle =
      survivorTitle ||
      survivor?.business_name ||
      survivor?.title ||
      survivor?.person_name ||
      null;

    let recAttached = 0;
    let recSkipped = 0;
    const pubType = survivor?.published_entity_type;
    const pubId = survivor?.published_entity_id;
    const canAttach =
      (pubType === "business" || pubType === "professional") && pubId;

    if (recommendationIds.length) {
      if (!canAttach) {
        recSkipped = recommendationIds.length;
      } else {
        for (const recId of recommendationIds) {
          const res = await confirmRecommendationMergeAction({
            id: recId,
            entityType: pubType as "business" | "professional",
            entityId: pubId as string,
          });
          if (res.ok) recAttached += 1;
          else recSkipped += 1;
        }
      }
    }

    const didAnything =
      mergedCount > 0 || catalogMerged || recAttached > 0 || changed.length > 0;

    if (!didAnything) {
      if (recSkipped > 0 && !canAttach) {
        return fail(
          "Ничего не объединилось. Рекомендацию нельзя привязать, пока карточка не влита в каталог — нажмите «Объединить» у Dance PROgression / бизнеса в списке, либо добавьте бизнес в «Объединить все».",
        );
      }
      return fail(
        "Ничего не объединилось: копий в очереди нет, в каталог не влили, рекомендации не привязались.",
      );
    }

    revalidatePath("/admin/import-review");
    revalidatePath("/admin/review/inbox");
    revalidatePath(`/admin/review/workspace/import_review/${survivorId}`);
    if (canAttach) {
      revalidatePath(
        pubType === "professional"
          ? `/professional/${pubId}`
          : `/business/${pubId}`,
      );
    }

    const parts = [
      mergedCount ? `копий свёрнуто: ${mergedCount}` : null,
      catalogMerged
        ? `влито в каталог «${catalogName || survivorTitle || survivorId}»`
        : null,
      recAttached ? `рекомендаций привязано: ${recAttached}` : null,
      recSkipped
        ? canAttach
          ? `рекомендаций не привязалось: ${recSkipped}`
          : `рекомендаций ждёт публикации: ${recSkipped}`
        : null,
      changed.length ? `дополнено: ${changed.join(", ")}` : null,
    ].filter(Boolean);

    const liveHref =
      canAttach
        ? await liveEntityHref(untyped(supabase), pubType, pubId)
        : null;

    return ok(
      `Объединено. Осталась «${survivorTitle || survivorId}». ${parts.join(" · ")}.`,
      {
        id: survivorId,
        publishedEntityType: pubType ?? undefined,
        publishedEntityId: pubId ?? undefined,
        liveHref: liveHref ?? undefined,
      },
    );
  } catch (err) {
    return fail(
      err instanceof Error ? err.message : "Не удалось объединить копии",
    );
  }
}

/**
 * After RPC fill-empty: push richer queue photo/name onto the live business.
 * Category SVGs and snake handles must not block a real photo / person name.
 */
async function applyRicherQueueFieldsToBusiness(
  catalog: SupabaseClient,
  businessId: string,
  queue: {
    preview_image_url?: string | null;
    person_name?: string | null;
    business_name?: string | null;
    title?: string | null;
    source_author_display_name?: string | null;
  },
): Promise<string[]> {
  const { data: biz } = await untyped(catalog)
    .from("businesses")
    .select("id, name, image_url")
    .eq("id", businessId)
    .maybeSingle();
  if (!biz) return [];

  const patch: Record<string, string> = {};
  const richerImage = preferRicherImage(biz.image_url, queue.preview_image_url);
  if (richerImage && richerImage !== String(biz.image_url || "").trim()) {
    patch.image_url = richerImage;
  }

  const candidateName =
    preferRicherIdentityName(null, queue.person_name) ||
    preferRicherIdentityName(null, queue.business_name) ||
    preferRicherIdentityName(null, queue.title) ||
    preferRicherIdentityName(null, queue.source_author_display_name);
  const richerName = preferRicherIdentityName(biz.name, candidateName);
  if (richerName && richerName !== String(biz.name || "").trim()) {
    patch.name = richerName;
  }

  if (!Object.keys(patch).length) return [];
  patch.updated_at = new Date().toISOString();
  const { error } = await untyped(catalog)
    .from("businesses")
    .update(patch)
    .eq("id", businessId);
  if (error) throw new Error(error.message);
  return Object.keys(patch).filter((k) => k !== "updated_at");
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

      // Enrich RPC rejects archived. Restore only to pending (admin), never
      // auto-approve — publishing to the public catalog stays an explicit step.
      const wasArchived = biz.status === "archived";
      if (wasArchived) {
        const { error: unarchiveErr } = await untyped(catalog)
          .from("businesses")
          .update({
            status: "pending",
            updated_at: new Date().toISOString(),
          })
          .eq("id", matchId);
        if (unarchiveErr) {
          return fail(
            `Не удалось вернуть бизнес в админку: ${unarchiveErr.message}`,
          );
        }
      }

      const { data, error: rpcError } = await untyped(catalog).rpc(
        "service_enrich_business_from_queue",
        {
          p_item_id: input.id,
          p_business_id: matchId,
          p_note: `Merge из inbox: ${input.matchReason || "match"}${
            wasArchived ? " (из архива → pending, без публикации)" : ""
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
      const restored = wasArchived
        ? " Вернули из архива как pending (не в открытом доступе)."
        : "";

      const { data: queueItemRaw } = await supabase
        .from("import_review_items")
        .select(
          "description, source_text, services, promotions, updates, preview_image_url, person_name, business_name, title, source_author_display_name",
        )
        .eq("id", input.id)
        .maybeSingle();
      const queueItem = (queueItemRaw ?? {}) as {
        description?: string | null;
        source_text?: string | null;
        services?: string[] | null;
        promotions?: QueuePromotion[] | null;
        updates?: QueueUpdate[] | null;
        preview_image_url?: string | null;
        person_name?: string | null;
        business_name?: string | null;
        title?: string | null;
        source_author_display_name?: string | null;
      };

      let richerFilled: string[] = [];
      try {
        richerFilled = await applyRicherQueueFieldsToBusiness(
          catalog,
          matchId,
          queueItem,
        );
      } catch (err) {
        console.error(
          "applyRicherQueueFieldsToBusiness failed",
          err instanceof Error ? err.message : err,
        );
      }
      const allFilled = Array.from(new Set([...filled, ...richerFilled]));

      const { data: bizAfter } = await untyped(catalog)
        .from("businesses")
        .select("name")
        .eq("id", matchId)
        .maybeSingle();
      const name =
        bizAfter?.name ||
        result.business_name ||
        input.matchTitle ||
        biz.name ||
        matchId;

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

      await runSettledRetention({
        itemId: input.id,
        previewImageUrl: queueItem.preview_image_url,
        publishedEntityType: "business",
        publishedEntityId: matchId,
      });

      const href =
        (slug ? `/business/${slug}` : null) ||
        (await liveEntityHref(catalog, "business", matchId));

      return ok(
        [
          allFilled.length
            ? `Объединено с «${name}»: добавлено ${allFilled.join(", ")}.`
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
          liveHref: href ?? undefined,
        },
      );
    } catch (err) {
      return fail(
        err instanceof Error ? err.message : "Не удалось объединить с бизнесом",
      );
    }
  }

  if (matchKind === "professional") {
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
    const { data: proRow, error: proErr } = await untyped(catalog)
      .from("professionals")
      .select("id, display_name, slug, status")
      .eq("id", matchId)
      .maybeSingle();
    if (proErr) return fail(proErr.message);
    if (!proRow) return fail("Специалист не найден.");

    // Restore archived only to pending — never auto-approve.
    if (proRow.status === "archived") {
      const { error: unarchiveErr } = await untyped(catalog)
        .from("professionals")
        .update({
          status: "pending",
          updated_at: new Date().toISOString(),
        })
        .eq("id", matchId);
      if (unarchiveErr) {
        return fail(
          `Не удалось вернуть специалиста в админку: ${unarchiveErr.message}`,
        );
      }
    }

    const { data: queueItemRaw } = await supabase
      .from("import_review_items")
      .select(
        "description, source_text, services, promotions, updates, phone, email, website, instagram, preview_image_url, person_name, business_name, title",
      )
      .eq("id", input.id)
      .maybeSingle();
    const queueItem = (queueItemRaw ?? {}) as {
      description?: string | null;
      source_text?: string | null;
      services?: string[] | null;
      promotions?: QueuePromotion[] | null;
      updates?: QueueUpdate[] | null;
      phone?: string[] | null;
      email?: string[] | null;
      website?: string[] | null;
      instagram?: string[] | null;
      preview_image_url?: string | null;
      person_name?: string | null;
      business_name?: string | null;
      title?: string | null;
    };

    const { data: keepPro } = await untyped(catalog)
      .from("professionals")
      .select(
        "id, display_name, phone, email, website, instagram_url, description, image_url",
      )
      .eq("id", matchId)
      .maybeSingle();
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    const filled: string[] = [];
    const empty = (v: unknown) =>
      v == null || (typeof v === "string" && !v.trim());
    if (keepPro) {
      if (empty(keepPro.phone) && queueItem.phone?.[0]) {
        patch.phone = queueItem.phone[0];
        filled.push("телефон");
      }
      if (empty(keepPro.email) && queueItem.email?.[0]) {
        patch.email = queueItem.email[0];
        filled.push("email");
      }
      if (empty(keepPro.website) && websiteFromQueue(queueItem.website)) {
        patch.website = websiteFromQueue(queueItem.website);
        filled.push("сайт");
      }
      if (empty(keepPro.instagram_url) && queueItem.instagram?.[0]) {
        const handle = queueItem.instagram[0].replace(/^@/, "");
        patch.instagram_url = `https://instagram.com/${handle}`;
        filled.push("instagram");
      }
      if (
        empty(keepPro.description) &&
        (queueItem.description || queueItem.source_text)
      ) {
        patch.description =
          queueItem.description || queueItem.source_text || null;
        filled.push("описание");
      }
      const richerImage = preferRicherImage(
        keepPro.image_url,
        queueItem.preview_image_url,
      );
      if (
        richerImage &&
        richerImage !== String(keepPro.image_url || "").trim()
      ) {
        patch.image_url = richerImage;
        filled.push("фото");
      }
    }
    if (Object.keys(patch).length > 1) {
      const { error: patchErr } = await untyped(catalog)
        .from("professionals")
        .update(patch)
        .eq("id", matchId);
      if (patchErr) return fail(patchErr.message);
    }

    const offersAdded = await addMissingProfessionalServices(
      catalog,
      matchId,
      offersFromQueueItem(queueItem),
    );
    const promosAdded = await addMissingEntityPromotions(
      catalog,
      "professional",
      matchId,
      promotionsFromQueueItem(queueItem),
    );
    const updatesAdded = await addMissingEntityUpdates(
      catalog,
      "professional",
      matchId,
      updatesFromQueueItem(queueItem),
      { source: "import" },
    );

    await untyped(supabase)
      .from("import_review_items")
      .update({
        review_status: "approved",
        published_entity_type: "professional",
        published_entity_id: matchId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id);

    const name = proRow.display_name || input.matchTitle || matchId;
    const href = proRow.slug
      ? `/professional/${proRow.slug}`
      : await liveEntityHref(catalog, "professional", matchId);

    revalidatePath("/admin/import-review");
    revalidatePath("/admin/review/inbox");
    if (href) revalidatePath(href);

    return ok(
      [
        filled.length
          ? `Объединено с «${name}»: добавлено ${filled.join(", ")}.`
          : `Объединено с «${name}» (новых полей не было).`,
        offersAdded ? ` Услуг добавлено: ${offersAdded}.` : "",
        promosAdded ? ` Акций добавлено: ${promosAdded}.` : "",
        updatesAdded ? ` Обновлений добавлено: ${updatesAdded}.` : "",
        proRow.status === "archived"
          ? " Специалист возвращён в pending (без авто-публикации)."
          : "",
      ].join(""),
      {
        id: input.id,
        publishedEntityType: "professional",
        publishedEntityId: matchId,
        liveHref: href ?? undefined,
      },
    );
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
      return mergeImportReviewIntoExistingAction({
        ...input,
        matchKind: "professional",
        matchId: target.published_entity_id,
        matchTitle: target.title || input.matchTitle,
      });
    }

    // Published as something we cannot fill from here (listing, event, job):
    // closing this card would drop its services and contacts for nothing.
    if (target?.published_entity_id) {
      return fail(
        `Совпадение уже опубликовано как ${target.published_entity_type}. Автоперенос данных для этого типа не сделан — карточка оставлена как есть.`,
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

    // No merge happened — closing this card here would throw its fields away,
    // so the moderator decides explicitly («Отклонить» рядом в списке).
    return fail(
      "Объединить нечего: совпадение уже закрыто или опубликовано. Карточка оставлена как есть.",
    );
  }

  if (matchKind === "recommendation") {
    const { data: source } = await untyped(supabase)
      .from("import_review_items")
      .select("id, published_entity_type, published_entity_id")
      .eq("id", input.id)
      .maybeSingle();
    const pubType = source?.published_entity_type;
    const pubId = source?.published_entity_id;
    if (
      (pubType !== "business" && pubType !== "professional") ||
      !pubId
    ) {
      return fail(
        "Рекомендацию привязать некуда: сначала опубликуйте эту карточку как бизнес или специалиста.",
      );
    }
    const res = await confirmRecommendationMergeAction({
      id: matchId,
      entityType: pubType,
      entityId: pubId,
    });
    if (!res.ok) return fail(res.message || "Не удалось привязать рекомендацию");
    revalidatePath("/admin/import-review");
    revalidatePath(`/admin/import-review/${input.id}`);
    revalidatePath("/admin/review/inbox");
    return ok(res.message || "Рекомендация привязана.", { id: input.id });
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

    // R14: same phone on professionals (not only businesses).
    const { data: pros } = await untyped(supabase)
      .from("professionals")
      .select("id, display_name, slug, phone, status")
      .in("phone", phones)
      .limit(8);
    for (const row of pros ?? []) {
      matches.push({
        kind: "professional",
        id: row.id,
        title: row.display_name,
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
        queueOpen: false,
        publishedEntityType: row.published_entity_type,
        publishedEntityId: row.published_entity_id,
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
        queueOpen: false,
        publishedEntityType: row.published_entity_type,
        publishedEntityId: row.published_entity_id,
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
        reason: `name:${row.name}`,
        slug: row.slug,
        businessStatus: row.status,
      });
    }

    const { data: prosByName } = await untyped(supabase)
      .from("professionals")
      .select("id, display_name, slug, status")
      .ilike("display_name", name)
      .limit(8);
    for (const row of prosByName ?? []) {
      matches.push({
        kind: "professional",
        id: row.id,
        title: row.display_name,
        reason: `name:${row.display_name}`,
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
        reason: `recurring_cluster:${item.recurring_cluster_id}`,
        queueOpen: false,
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
      queueOpen: true,
    });
  }

  // Community recommendations that look like the same advertiser.
  const recHits = await findMatchingRecommendations(untyped(supabase), {
    phones: item.phone ?? [],
    instagram: item.instagram ?? [],
    website: item.website ?? [],
    telegram_username: item.telegram_username,
    business_name: item.business_name,
    title: item.title,
    person_name: item.person_name,
  });
  for (const rec of recHits) {
    matches.push({
      kind: "recommendation",
      id: rec.id,
      title: rec.title,
      reason: rec.reason,
      mentionCount: rec.mentionCount,
      thirdPartyMentions: rec.thirdParty,
      selfAdMentions: rec.selfAd,
      snippet: rec.snippet,
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

  // Already linked to a live card — don't resurface that same business / the
  // approved import that points at it. Merge already happened.
  const linkedIds = new Set(
    [
      item.published_entity_id,
      (item as { duplicate_of_entity_id?: string | null }).duplicate_of_entity_id,
    ]
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  );
  const actionable = linkedIds.size
    ? unique.filter((m) => {
        if (
          m.kind === "business" ||
          m.kind === "professional" ||
          m.kind === "listing"
        ) {
          return !linkedIds.has(m.id);
        }
        if (m.kind === "import_item" && m.publishedEntityId) {
          return !linkedIds.has(m.publishedEntityId);
        }
        return true;
      })
    : unique;

  actionable.sort((a, b) => {
    const rank = (m: DuplicateMatch) => {
      if (m.kind === "business" && m.businessStatus === "archived") return 4;
      if (m.kind === "professional" && m.businessStatus === "archived") return 4;
      if (m.kind === "business") return 0;
      if (m.kind === "professional") return 0;
      if (m.kind === "import_item") return 1;
      if (m.kind === "recommendation") return 2;
      return 5;
    };
    return rank(a) - rank(b);
  });
  return actionable;
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

  // Map businesses need a street pin. Import cards without one stay specialists;
  // owners can claim a pro card and upgrade later.
  if (
    item.target_collection === "businesses" ||
    item.target_collection === "organizations" ||
    item.target_collection === "services"
  ) {
    const { hasStreetAddress } = await import(
      "@/lib/import-review/entity-routing"
    );
    if (
      !hasStreetAddress({
        addressLine: item.address_line,
        postalCode: item.postal_code,
      })
    ) {
      return fail(
        "Без точного уличного адреса карточка идёт в Специалисты (бизнес — на карте). Укажите адрес или смените тип на профи.",
      );
    }
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
    const mergeAllPreview = await buildMergeAllPreview(
      supabase,
      input.id,
      withPreview,
    );
    return fail(
      "Найдены возможные дубликаты. Проверьте совпадения или повторите с подтверждением.",
      withPreview,
      mergeAllPreview,
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

  const translateTitle =
    collection === "events" ||
    collection === "jobs" ||
    collection === "marketplace" ||
    collection === "lechu" ||
    collection === "transfers" ||
    collection === "real_estate";
  const { resolvePublishNarrative } = await import(
    "@/lib/content/translate-copy-to-ru"
  );
  const narrative = await resolvePublishNarrative({
    title: String(title).trim(),
    description: item.description ?? item.source_text ?? null,
    descriptionOriginal: item.description_original ?? null,
    sourceLanguage: item.source_language ?? null,
    translateTitle,
  });
  const { redactContactsFromPublicText } = await import(
    "@/lib/content/structure-business-profile"
  );
  // R12: contacts/address never stay in public description on approve.
  const publishedDescription = redactContactsFromPublicText(
    narrative.description,
  );
  const descriptionOriginal = narrative.descriptionOriginal
    ? redactContactsFromPublicText(narrative.descriptionOriginal)
    : null;
  const publishedTitle = narrative.title;
  // Persist RU + original back onto the queue row so admin preview stays in sync.
  if (
    publishedDescription !== (item.description || null) ||
    descriptionOriginal !== (item.description_original || null)
  ) {
    await untyped(supabase)
      .from("import_review_items")
      .update({
        description: publishedDescription,
        description_original: descriptionOriginal,
        source_language: narrative.sourceLanguage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id);
  }

  // Professional Cleanup handoff: confirming as specialist keeps the existing
  // live Professional (no duplicate insert). Other targets create a new entity
  // and archive the linked Professional after success.
  if (cleanup && collection === "private_specialists") {
    const displayName = String(
      item.person_name?.trim() || title || "Специалист",
    ).trim();
    const patch: Record<string, unknown> = {
      display_name: displayName.slice(0, 120),
      short_description: (publishedDescription ?? "").slice(0, 280) || null,
      description: publishedDescription,
      description_original: descriptionOriginal,
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

    const thinGate = evaluateThinProfessionalPublish({
      displayName: String(
        item.person_name?.trim() || title || "",
      ),
      phone: item.phone,
      email: item.email,
      website: item.website,
      instagram: item.instagram,
      whatsapp: item.whatsapp,
    });
    if (!thinGate.ok) return fail(thinGate.message);

    // Exact visual twin: same weak/normalized name already approved.
    const nameKey = normalizePersonName(
      String(item.person_name?.trim() || title || ""),
    );
    if (nameKey.length >= 2) {
      const { data: twinPros } = await untyped(supabase)
        .from("professionals")
        .select("id, display_name, slug, status")
        .eq("status", "approved")
        .ilike("display_name", nameKey)
        .limit(5);
      const twins = (twinPros ?? []).filter(
        (row: { display_name?: string | null }) =>
          normalizePersonName(row.display_name) === nameKey,
      );
      if (twins.length > 0 && !input.force) {
        const t0 = twins[0] as { display_name?: string; slug?: string };
        return fail(
          `Уже есть специалист «${t0.display_name}» (${t0.slug || twins[0].id}). Объедините двойника, не публикуйте клон.`,
        );
      }
    }

    // R09: ban silent pro_other — require a real category on the queue row.
    const categorySlug =
      (typeof item.category === "string" && item.category.trim()) ||
      (typeof (item as { category_slug?: string }).category_slug === "string" &&
        (item as { category_slug?: string }).category_slug?.trim()) ||
      null;
    if (!categorySlug || categorySlug === "pro_other") {
      return fail(
        "Выберите категорию специалиста (не «Прочее») перед публикацией.",
      );
    }
    const { data: catRow } = await supabase
      .from("categories")
      .select("id")
      .eq("domain", "professional")
      .eq("slug", categorySlug)
      .eq("is_active", true)
      .maybeSingle();
    if (!catRow?.id) {
      return fail(
        `Категория «${categorySlug}» не найдена. Выберите категорию перед публикацией.`,
      );
    }

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
        short_description: (publishedDescription ?? "").slice(0, 280) || null,
        description: publishedDescription,
        description_original: descriptionOriginal,
        status: "approved",
        visibility: "public",
        category_id: catRow.id,
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
        p_short_description: (publishedDescription ?? "").slice(0, 240) || null,
        p_description: publishedDescription,
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
      description_original?: string | null;
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
      description_original: descriptionOriginal,
    };
    // Street address on the card → geocode now, so the published card opens
    // with a pin instead of waiting for a later enrich pass.
    if (streetAddress) {
      const geo = await geocodeStreetAddress(
        {
          addressLine: streetAddress,
          city: loc.city,
          stateCode: loc.stateCode,
          postalCode,
        },
        { attempts: "ladder" },
      );
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
        title: publishedTitle.slice(0, 200),
        slug: jobSlug,
        description: publishedDescription,
        description_original: descriptionOriginal,
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
        title: publishedTitle.slice(0, 200),
        description: publishedDescription ?? "",
        description_original: descriptionOriginal,
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
    const { hasDateSignal } = await import("@/lib/import-review/entity-routing");
    // R07: multiple date signals but only one structured occurrence → block.
    if (
      hasDateSignal(blob) &&
      structured.occurrences.length <= 1 &&
      (blob.match(
        /\b(?:\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?|\d{1,2}\s+(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/gi,
      )?.length ?? 0) >= 2
    ) {
      return fail(
        "В посте несколько дат, но структура нашла одну. Нажмите «Обогатить» или подтвердите даты, затем Approve.",
      );
    }
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
      publishedDescription ||
      item.description ||
      null;
    const venueName =
      (typeof stored.venue_name === "string" && stored.venue_name.trim()) ||
      null;
    const category =
      (typeof stored.category === "string" && stored.category.trim()) || null;
    let eventSourceLanguage =
      (typeof stored.source_language === "string" &&
        stored.source_language.trim()) ||
      narrative.sourceLanguage ||
      null;
    let titleOriginal =
      (typeof stored.title_original === "string" &&
        stored.title_original.trim()) ||
      null;
    let eventDescriptionOriginal =
      (typeof stored.description_original === "string" &&
        stored.description_original.trim()) ||
      descriptionOriginal ||
      null;

    let eventPublishedTitle = eventTitle;
    let eventPublishedDescription = description;

    // English (or mostly-Latin) affiches → Russian copy for the public card;
    // keep the author's original behind «Показать оригинал».
    const alreadyHasOriginal =
      Boolean(eventDescriptionOriginal?.trim()) &&
      eventDescriptionOriginal!.trim() !==
        (eventPublishedDescription || "").trim();
    if (!alreadyHasOriginal) {
      try {
        const { translateEventCopyToRu } = await import(
          "@/lib/events/translate-event"
        );
        const translated = await translateEventCopyToRu({
          title: eventPublishedTitle,
          description: eventPublishedDescription,
        });
        if (translated.detectedLanguage !== "ru") {
          eventPublishedTitle = translated.titleRu;
          eventPublishedDescription = translated.descriptionRu;
          titleOriginal = translated.titleOriginal;
          eventDescriptionOriginal =
            translated.descriptionOriginal || eventDescriptionOriginal;
          eventSourceLanguage = translated.detectedLanguage;
        } else if (!eventSourceLanguage) {
          eventSourceLanguage = "ru";
        }
      } catch {
        // Publish without translation if the LLM path fails — moderators can retry.
      }
    }

    // One affiche can announce several dates — each date is its own event,
    // with a title from that schedule line when the line names the session.
    const sessions = structured.occurrences.length
      ? structured.occurrences
      : [{ label: eventAtLabel ?? "", startsAt }];

    const rows = sessions.map((session, index) => {
      const fromLabel = titleFromOccurrenceLabel(session.label);
      const sessionTitle = (fromLabel || eventPublishedTitle).slice(0, 200);
      return {
      owner_profile_id: user.id,
      title: sessionTitle,
      slug:
        index === 0
          ? slugify(sessionTitle)
          : `${slugify(sessionTitle)}-${index + 1}`,
      description: eventPublishedDescription,
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
      source_language: eventSourceLanguage,
      title_original: titleOriginal,
      description_original: eventDescriptionOriginal,
      registration_url: registrationUrl,
      source_url: item.source_url?.trim() || null,
      source_channel: resolveSourceKind(item.source_url, item.source),
      // Dedupe key with external_id — stays the raw queue source, not provenance.
      external_source: item.source?.split(":")[0] || "telegram",
      source_body: item.source_text ?? item.description ?? null,
      format: "offline",
    };
    });

    const { data: inserted, error: insertError } = await untyped(supabase)
      .from("events")
      .insert(rows)
      .select("id");
    if (insertError || !inserted?.length) {
      return fail(insertError?.message || "Не удалось создать event.");
    }
    publishedEntityType = "event";
    publishedEntityId = (inserted as { id: string }[])[0]!.id;
    const allEventIds = (inserted as { id: string }[]).map((r) => r.id);
    if (allEventIds.length > 1) {
      await untyped(supabase)
        .from("import_review_items")
        .update({
          review_notes: [
            item.review_notes,
            `[published_event_ids:${allEventIds.join(",")}]`,
          ]
            .filter(Boolean)
            .join(" "),
          updated_at: new Date().toISOString(),
        })
        .eq("id", input.id);
    }
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
