"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import type {
  ImportReviewEntityType,
  ImportReviewStatus,
  ImportReviewTargetCollection,
} from "@/types/import-review";

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

function mapDbError(error: { message?: string } | null): string {
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

  const title =
    item.title || item.business_name || item.person_name || item.source_text;
  if (!title?.trim()) {
    return fail("Нужно название (title / business_name / person_name).");
  }
  if (!item.target_collection) {
    return fail("Укажите target_collection.");
  }
  if (!item.entity_type) {
    return fail("Укажите entity_type.");
  }

  const hasContact =
    (item.phone?.length ?? 0) > 0 ||
    (item.whatsapp?.length ?? 0) > 0 ||
    (item.instagram?.length ?? 0) > 0 ||
    (item.website?.length ?? 0) > 0 ||
    (item.email?.length ?? 0) > 0 ||
    Boolean(item.telegram_username) ||
    Boolean(item.telegram_user_id);
  if (!hasContact) {
    return fail("Нужен хотя бы один контакт.");
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

  if (
    collection === "businesses" ||
    collection === "private_specialists" ||
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
        p_city: item.city ?? null,
        p_address_line: null,
        p_status: "approved",
        p_category_id: null,
      },
    );
    if (upsertError) return fail(mapDbError(upsertError));
    publishedEntityType = "business";
    publishedEntityId = businessId as string;

    // Best-effort contact extras
    if (item.instagram?.[0] || item.telegram_username) {
      await supabase
        .from("businesses")
        .update({
          instagram_url: item.instagram?.[0]
            ? `https://instagram.com/${item.instagram[0].replace(/^@/, "")}`
            : undefined,
        })
        .eq("id", publishedEntityId);
    }
  } else if (
    collection === "marketplace" ||
    collection === "real_estate" ||
    collection === "jobs"
  ) {
    // Create as draft listing owned by approving admin — then activate via admin_set_listing_status.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fail("Нужно войти в аккаунт.");

    const listingType =
      collection === "jobs"
        ? "job"
        : collection === "real_estate"
          ? "marketplace_item"
          : "marketplace_item";

    const { data: inserted, error: insertError } = await supabase
      .from("listings")
      .insert({
        owner_id: user.id,
        listing_type: listingType,
        status: "draft",
        visibility: "unlisted",
        title: String(title).trim(),
        description: item.description ?? item.source_text ?? "",
        price_amount: item.price,
        price_currency: item.currency ?? "USD",
        city: item.city,
        state: item.state,
        publisher_type: "profile",
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
    return fail(
      "Коллекция events ещё не реализована в рабочих таблицах. Смените target_collection или дождитесь схемы events.",
    );
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
