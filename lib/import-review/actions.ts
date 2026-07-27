"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import { mergeLocationWithGroupFallback } from "@/lib/geo/source-group-location";
import { inferLocationPrecision } from "@/lib/business/location-precision";
import { resolveImportDisplayName } from "@/lib/import-review/display-name";
import type {
  ImportReviewEntityType,
  ImportReviewStatus,
  ImportReviewTargetCollection,
} from "@/types/import-review";

/** Untyped access until generated Database types include professionals/events. */
function untyped(client: SupabaseClient) {
  return client as unknown as SupabaseClient;
}

function resolveImportLocation(item: {
  city?: string | null;
  state?: string | null;
  source_group?: string | null;
  source?: string | null;
  source_url?: string | null;
}) {
  return mergeLocationWithGroupFallback({
    city: item.city,
    region: item.state,
    sourceGroup: item.source_group,
    source: item.source ?? item.source_url,
  });
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
};

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

  revalidatePath("/admin/import-review");
  revalidatePath(`/admin/import-review/${input.id}`);

  const messages: Record<ImportReviewStatus, string> = {
    pending: "Статус: ожидает проверки.",
    in_review: "Карточка взята в работу.",
    approved: "Одобрено.",
    rejected: "Отклонено.",
    duplicate: "Помечено как дубликат.",
    needs_more_info: "Отмечено: нужна информация.",
    ready_to_publish: "Готова к публикации.",
  };
  return ok(messages[input.status] ?? "Статус обновлён.");
}

async function findDuplicateMatches(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  item: {
    phone: string[] | null;
    telegram_user_id: string | null;
    telegram_username: string | null;
    instagram: string[] | null;
    website: string[] | null;
    title: string | null;
    business_name: string | null;
    person_name: string | null;
    recurring_cluster_id: string | null;
    id: string;
  },
): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];
  const phones = item.phone ?? [];
  const name = (item.business_name || item.title || item.person_name || "")
    .trim()
    .toLowerCase();

  if (phones.length) {
    const { data } = await supabase
      .from("businesses")
      .select("id, name, phone")
      .in("phone", phones)
      .limit(5);
    for (const row of data ?? []) {
      matches.push({
        kind: "business",
        id: row.id,
        title: row.name,
        reason: `phone:${row.phone}`,
      });
    }
  }

  if (item.telegram_username) {
    const { data } = await supabase
      .from("import_review_items")
      .select("id, title, telegram_username, review_status")
      .eq("telegram_username", item.telegram_username)
      .neq("id", item.id)
      .eq("review_status", "approved")
      .limit(5);
    for (const row of data ?? []) {
      matches.push({
        kind: "import_item",
        id: row.id,
        title: row.title,
        reason: `telegram:@${item.telegram_username}`,
      });
    }
  }

  if (item.telegram_user_id) {
    const { data } = await supabase
      .from("import_review_items")
      .select("id, title, telegram_user_id, review_status")
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
      .select("id, name")
      .ilike("name", name)
      .limit(5);
    for (const row of data ?? []) {
      matches.push({
        kind: "business",
        id: row.id,
        title: row.name,
        reason: "normalized_name",
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

  // de-dupe by kind+id
  const seen = new Set<string>();
  return matches.filter((m) => {
    const key = `${m.kind}:${m.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function approveImportReviewItemAction(input: {
  id: string;
  force?: boolean;
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

  const duplicates = await findDuplicateMatches(supabase, item);
  if (duplicates.length > 0 && !input.force) {
    return fail(
      "Найдены возможные дубликаты. Проверьте совпадения или повторите с подтверждением.",
      duplicates,
    );
  }

  const collection = item.target_collection as ImportReviewTargetCollection;
  let publishedEntityType: string;
  let publishedEntityId: string;
  const loc = resolveImportLocation(item);
  const locationPrecision =
    loc.region && !loc.city ? ("county" as const) : null;

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
    const sourceType = item.source?.toLowerCase().startsWith("facebook")
      ? "FACEBOOK"
      : item.source?.toLowerCase().includes("telegram")
        ? "TELEGRAM"
        : "IMPORT";
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
        location_precision: locationPrecision,
        // Area-only: never invent map pins without a street address.
        latitude: null,
        longitude: null,
        public_exact_address: false,
        phone: item.phone?.[0] ?? null,
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
        p_address_line: null,
        p_status: "approved",
        p_category_id: null,
      },
    );
    if (upsertError) return fail(mapDbError(upsertError));
    publishedEntityType = "business";
    publishedEntityId = businessId as string;

    const sourceUrl = item.source_url?.trim() || null;
    const sourceKind = sourceUrl
      ? item.source?.toLowerCase().startsWith("facebook")
        ? "facebook"
        : "telegram"
      : "platform";
    const telegramUsername = item.telegram_username?.replace(/^@/, "").trim();
    const businessPrecision = inferLocationPrecision({
      addressLine: null,
      city: loc.city,
      region: loc.region,
    });
    const extras: {
      source_url: string | null;
      source_kind: "telegram" | "facebook" | "platform";
      instagram_url?: string;
      telegram_url?: string | null;
      city?: string | null;
      region?: string | null;
      state_code?: string | null;
      location_precision?: "street" | "county" | null;
      latitude?: null;
      longitude?: null;
    } = {
      source_url: sourceUrl,
      source_kind: sourceKind,
      city: loc.city,
      region: loc.region,
      state_code: loc.stateCode || "US-CA",
      // Business map pins require street; county/city stay off the map.
      location_precision: businessPrecision === "county" ? "county" : null,
      latitude: null,
      longitude: null,
    };
    if (item.instagram?.[0]) {
      extras.instagram_url = `https://instagram.com/${item.instagram[0].replace(/^@/, "")}`;
    }
    if (telegramUsername) {
      extras.telegram_url = `https://t.me/${telegramUsername}`;
    }
    await supabase.from("businesses").update(extras).eq("id", publishedEntityId);
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
        status: "published",
        visibility: "public",
        source_type: item.source?.toLowerCase().startsWith("facebook")
          ? "FACEBOOK"
          : "TELEGRAM",
        source_url: item.source_url?.trim() || null,
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
    collection === "real_estate"
  ) {
    // Create as draft listing owned by approving admin — then activate via admin_set_listing_status.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fail("Нужно войти в аккаунт.");

    const listingType = "marketplace_item";

    const { data: inserted, error: insertError } = await supabase
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
        publisher_type: "profile",
        source_url: item.source_url?.trim() || null,
        source_kind: item.source_url?.trim()
          ? item.source?.toLowerCase().startsWith("facebook")
            ? "facebook"
            : "telegram"
          : "platform",
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
    const slug = slugify(eventTitle);
    const { data: inserted, error: insertError } = await untyped(supabase)
      .from("events")
      .insert({
        owner_profile_id: user.id,
        title: eventTitle.slice(0, 200),
        slug,
        description: item.description ?? item.source_text ?? null,
        status: "published",
        city: item.city ?? null,
        state_code: "US-CA",
        source_url: item.source_url?.trim() || null,
        source_channel: item.source?.split(":")[0] || "telegram",
        source_body: item.source_text ?? item.description ?? null,
        format: "offline",
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      return fail(insertError?.message || "Не удалось создать event.");
    }
    publishedEntityType = "event";
    publishedEntityId = (inserted as { id: string }).id;
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

  revalidatePath("/admin/import-review");
  revalidatePath(`/admin/import-review/${input.id}`);
  revalidatePath("/admin/businesses");
  revalidatePath("/admin/listings");
  return ok("Одобрено и создана рабочая запись.", {
    publishedEntityType,
    publishedEntityId,
  });
}
