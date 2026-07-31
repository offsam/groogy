"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { userIsAdmin } from "@/lib/reviews/queries";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import type { LiveEntityKind } from "@/lib/admin/published-duplicates-scan";

export type EntitySourceKind =
  | "import"
  | "import_duplicate"
  | "recommendation"
  | "mention"
  | "profile";

export type EntitySourceHit = {
  kind: EntitySourceKind;
  id: string;
  title: string;
  status?: string | null;
  reason?: string | null;
  href?: string | null;
  sourceUrl?: string | null;
  createdAt?: string | null;
};

function untyped(client: SupabaseClient) {
  return client as unknown as SupabaseClient;
}

async function requireAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Нужна авторизация." as const };
  if (!(await userIsAdmin(supabase))) {
    return { error: "Только для администраторов." as const };
  }
  let catalog: ReturnType<typeof createServiceRoleClient>;
  try {
    catalog = createServiceRoleClient();
  } catch {
    catalog = supabase as never;
  }
  return { supabase, catalog, error: null as null };
}

function workspaceHref(reviewType: string, id: string): string {
  return `/admin/review/${encodeURIComponent(`${reviewType}:${id}`)}`;
}

/**
 * Everything that fed a live card: queue rows that published into it,
 * queue copies folded into those rows, attached recommendations, and
 * community mention records.
 */
export async function listEntityMergeSourcesAction(input: {
  entityType: LiveEntityKind;
  entityId: string;
}): Promise<
  | { ok: true; selfName: string; sources: EntitySourceHit[] }
  | { ok: false; message: string }
> {
  const auth = await requireAdmin();
  if (auth.error) return { ok: false, message: auth.error };
  const { catalog } = auth;
  const db = untyped(catalog);

  const isPro = input.entityType === "professional";
  const isBiz = input.entityType === "business";
  if (!isPro && !isBiz) {
    return {
      ok: false,
      message: "История источников пока только для бизнесов и специалистов.",
    };
  }

  const table = isPro ? "professionals" : "businesses";
  const { data: self, error: selfErr } = await db
    .from(table)
    .select(
      isPro
        ? "id, slug, display_name, phone, website, instagram_url, telegram_url, source_url"
        : "id, slug, name, phone, website, instagram_url, telegram_url, source_url",
    )
    .eq("id", input.entityId)
    .maybeSingle();
  if (selfErr) return { ok: false, message: selfErr.message };
  if (!self) return { ok: false, message: "Карточка не найдена." };

  const selfName = String(
    (self as { display_name?: string; name?: string }).display_name ||
      (self as { name?: string }).name ||
      "Карточка",
  );
  const sources: EntitySourceHit[] = [];

  const profileBits: string[] = [];
  for (const [label, value] of [
    ["телефон", (self as { phone?: string | null }).phone],
    ["сайт", (self as { website?: string | null }).website],
    ["instagram", (self as { instagram_url?: string | null }).instagram_url],
    ["telegram", (self as { telegram_url?: string | null }).telegram_url],
    ["source_url", (self as { source_url?: string | null }).source_url],
  ] as const) {
    if (value) profileBits.push(`${label}: ${value}`);
  }
  if (profileBits.length || (self as { source_url?: string | null }).source_url) {
    sources.push({
      kind: "profile",
      id: input.entityId,
      title: selfName,
      reason: profileBits.join(" · ") || "поля профиля",
      href: isPro
        ? `/professional/${(self as { slug: string }).slug}`
        : `/business/${(self as { slug: string }).slug}`,
      sourceUrl: (self as { source_url?: string | null }).source_url ?? null,
    });
  }

  const publishedType = isPro ? "professional" : "business";
  const { data: imports } = await db
    .from("import_review_items")
    .select(
      "id, title, business_name, person_name, review_status, source_url, source, telegram_username, phone, created_at, review_notes",
    )
    .eq("published_entity_type", publishedType)
    .eq("published_entity_id", input.entityId)
    .order("created_at", { ascending: true })
    .limit(100);

  const importIds: string[] = [];
  const seenImport = new Set<string>();
  for (const row of (imports ?? []) as Array<Record<string, unknown>>) {
    const id = String(row.id);
    seenImport.add(id);
    importIds.push(id);
    const sourceUrl = (row.source_url as string) || null;
    sources.push({
      kind: "import",
      id,
      title: String(
        row.business_name || row.person_name || row.title || row.id,
      ),
      status: String(row.review_status || ""),
      reason: row.telegram_username
        ? `источник · @${row.telegram_username}`
        : "источник импорта",
      // Prefer the original post URL — the poor queue card is gone as a task.
      href: sourceUrl || workspaceHref("import_review", id),
      sourceUrl,
      createdAt: (row.created_at as string) || null,
    });
  }

  // Marked duplicate of this live entity without published_entity_* filled.
  const { data: entityDupes } = await db
    .from("import_review_items")
    .select(
      "id, title, business_name, person_name, review_status, source_url, telegram_username, created_at",
    )
    .eq("duplicate_of_entity_type", publishedType)
    .eq("duplicate_of_entity_id", input.entityId)
    .order("created_at", { ascending: true })
    .limit(100);
  for (const row of (entityDupes ?? []) as Array<Record<string, unknown>>) {
    const id = String(row.id);
    if (seenImport.has(id)) continue;
    seenImport.add(id);
    importIds.push(id);
    const sourceUrl = (row.source_url as string) || null;
    sources.push({
      kind: "import",
      id,
      title: String(
        row.business_name || row.person_name || row.title || row.id,
      ),
      status: String(row.review_status || ""),
      reason: "источник · дубль live-карточки",
      href: sourceUrl || workspaceHref("import_review", id),
      sourceUrl,
      createdAt: (row.created_at as string) || null,
    });
  }

  if (importIds.length) {
    const { data: folded } = await db
      .from("import_review_items")
      .select(
        "id, title, business_name, person_name, review_status, source_url, telegram_username, duplicate_of_item_id, created_at",
      )
      .in("duplicate_of_item_id", importIds)
      .order("created_at", { ascending: true })
      .limit(200);
    for (const row of (folded ?? []) as Array<Record<string, unknown>>) {
      const id = String(row.id);
      if (seenImport.has(id)) continue;
      seenImport.add(id);
      const sourceUrl = (row.source_url as string) || null;
      sources.push({
        kind: "import_duplicate",
        id,
        title: String(
          row.business_name || row.person_name || row.title || row.id,
        ),
        status: String(row.review_status || ""),
        reason: `источник · свёрнутая копия`,
        href: sourceUrl || workspaceHref("import_review", id),
        sourceUrl,
        createdAt: (row.created_at as string) || null,
      });
    }
  }

  const { data: recs } = await db
    .from("import_comment_recommendations")
    .select(
      "id, display_name, status, mention_count, third_party_mention_count, self_ad_mention_count, source_post_urls, published_entity_id, duplicate_of_entity_id, duplicate_reason, created_at",
    )
    .or(
      `published_entity_id.eq.${input.entityId},duplicate_of_entity_id.eq.${input.entityId}`,
    )
    .order("mention_count", { ascending: false })
    .limit(100);
  for (const row of (recs ?? []) as Array<Record<string, unknown>>) {
    const urls = (row.source_post_urls as string[]) || [];
    sources.push({
      kind: "recommendation",
      id: String(row.id),
      title: String(row.display_name || row.id),
      status: String(row.status || ""),
      reason:
        row.duplicate_reason
          ? String(row.duplicate_reason)
          : `рекомендация · упоминаний ${row.mention_count ?? 1}`,
      href: workspaceHref("recommendation", String(row.id)),
      sourceUrl: urls[0] || null,
      createdAt: (row.created_at as string) || null,
    });
  }

  const mentionTable = isPro
    ? "professional_community_mentions"
    : "business_community_mentions";
  const mentionFk = isPro ? "professional_id" : "business_id";
  const { data: mentions } = await db
    .from(mentionTable)
    .select(
      "id, kind, source_url, source_label, source_record_id, status, created_at",
    )
    .eq(mentionFk, input.entityId)
    .order("created_at", { ascending: false })
    .limit(100);
  for (const row of (mentions ?? []) as Array<Record<string, unknown>>) {
    sources.push({
      kind: "mention",
      id: String(row.id),
      title: String(row.source_label || row.kind || "упоминание"),
      status: String(row.status || ""),
      reason: String(row.kind || "community_mention"),
      sourceUrl: (row.source_url as string) || null,
      createdAt: (row.created_at as string) || null,
    });
  }

  return { ok: true, selfName, sources };
}
