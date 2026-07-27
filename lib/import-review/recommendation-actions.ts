"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/reviews/queries";
import { mergeLocationWithGroupFallback } from "@/lib/geo/source-group-location";
import { inferLocationPrecision } from "@/lib/business/location-precision";
import {
  businessSlugFromGuess,
  professionalSlugFromGuess,
} from "@/lib/import-review/recommendation-category";
import type { CommentRecommendation } from "@/lib/import-review/recommendation-queries";
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
    }
  | { ok: false; message: string };

function fail(message: string): ActionResult {
  return { ok: false, message };
}

function ok(
  message?: string,
  extra?: {
    publishedEntityType?: string;
    publishedEntityId?: string;
    publicPath?: string;
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
  revalidatePath("/search");
  revalidatePath("/");
}

export async function rejectCommentRecommendationAction(input: {
  id: string;
}): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return error;

  const item = await loadRecommendation(supabase, input.id);
  if (!item) return fail("Запись не найдена.");
  if (item.status === "approved") {
    return fail("Уже одобрено — отклонить нельзя.");
  }

  const { error: updError } = await recommendationsTable(supabase)
    .update({ status: "rejected" })
    .eq("id", input.id);
  if (updError) return fail(updError.message || "Не удалось отклонить.");

  revalidateRecommendationPaths(item);
  return ok("Отклонено.");
}

export async function approveCommentRecommendationAction(input: {
  id: string;
}): Promise<ActionResult> {
  const { supabase, user, error } = await requireAdmin();
  if (error) return error;
  if (!user) return fail("Нужно войти в аккаунт.");

  const item = await loadRecommendation(supabase, input.id);
  if (!item) return fail("Запись не найдена.");

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

  const name = (item.display_name || "").trim();
  if (!name || name === "Без названия") {
    return fail("Нужно название.");
  }

  const phone = firstPhone(item.phones || []);
  const instagram = igUrl(item.instagram || []);
  const website = plainWebsite(item.websites || []);
  const telegram = tgUrl(item.websites || []);
  const sourceUrl = item.source_post_urls?.[0] || null;
  const hasContact = Boolean(phone || instagram || website || telegram || sourceUrl);
  if (!hasContact) {
    return fail("Нужен хотя бы один контакт или ссылка на пост.");
  }

  const kind = yellowPagesEntityKind(item);
  const loc = resolveLocation(item);
  const description = descriptionFrom(item);
  const now = new Date().toISOString();
  const sourceType =
    item.source_channel === "telegram"
      ? "TELEGRAM"
      : item.source_channel === "facebook"
        ? "FACEBOOK"
        : "IMPORT";
  const sourceKind =
    item.source_channel === "telegram" || item.source_channel === "facebook"
      ? item.source_channel
      : "platform";

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
        region: loc.region,
        state_code: loc.stateCode || "US-CA",
        location_precision: loc.city ? "city" : loc.region ? "county" : null,
        public_exact_address: false,
        latitude: null,
        longitude: null,
        phone,
        email: preview.email,
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
        p_address_line: preview.addressLine,
        p_status: "approved",
        p_category_id: categoryId,
      },
    );
    if (upsertError) return fail(upsertError.message || "Не удалось создать бизнес.");
    publishedEntityType = "business";
    publishedEntityId = businessId as string;

    const precision = inferLocationPrecision({
      addressLine: preview.addressLine,
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
        location_precision: precision === "county" ? "county" : null,
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

export type RecommendationActionResult = ActionResult;
