import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EntityUpdate,
  QueueUpdate,
  UpdateOwnerType,
  UpdateSource,
} from "@/types/update";

function untyped(client: SupabaseClient) {
  return client as unknown as SupabaseClient;
}

type UpdateRow = {
  id: string;
  owner_type: UpdateOwnerType;
  owner_id: string;
  title: string;
  body: string | null;
  status: EntityUpdate["status"];
  source: UpdateSource;
  source_url: string | null;
  published_at: string;
};

function mapRow(
  row: UpdateRow,
  owner?: {
    name?: string | null;
    slug?: string | null;
    href?: string | null;
    imageUrl?: string | null;
  },
): EntityUpdate {
  return {
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    title: row.title,
    body: row.body,
    status: row.status,
    source: row.source,
    sourceUrl: row.source_url,
    publishedAt: row.published_at,
    ownerName: owner?.name ?? null,
    ownerSlug: owner?.slug ?? null,
    ownerHref: owner?.href ?? null,
    ownerImageUrl: owner?.imageUrl ?? null,
  };
}

const SELECT =
  "id, owner_type, owner_id, title, body, status, source, source_url, published_at";

async function resolveOwners(
  client: SupabaseClient,
  rows: UpdateRow[],
): Promise<EntityUpdate[]> {
  const businessIds = rows
    .filter((r) => r.owner_type === "business")
    .map((r) => r.owner_id);
  const professionalIds = rows
    .filter((r) => r.owner_type === "professional")
    .map((r) => r.owner_id);

  const businessMap = new Map<
    string,
    { name: string; slug: string; imageUrl: string | null }
  >();
  const professionalMap = new Map<
    string,
    { name: string; slug: string; imageUrl: string | null }
  >();

  if (businessIds.length) {
    const { data: businesses } = await client
      .from("businesses")
      .select("id, name, slug, image_url")
      .in("id", businessIds)
      .eq("status", "approved");
    for (const b of businesses ?? []) {
      businessMap.set(b.id, {
        name: b.name,
        slug: b.slug,
        imageUrl: b.image_url,
      });
    }
  }
  if (professionalIds.length) {
    const { data: pros } = await untyped(client)
      .from("professionals")
      .select("id, display_name, slug, image_url")
      .in("id", professionalIds)
      .eq("status", "approved");
    for (const p of (pros ?? []) as Array<{
      id: string;
      display_name: string;
      slug: string;
      image_url: string | null;
    }>) {
      professionalMap.set(p.id, {
        name: p.display_name,
        slug: p.slug,
        imageUrl: p.image_url,
      });
    }
  }

  return rows
    .map((row) => {
      if (row.owner_type === "business") {
        const o = businessMap.get(row.owner_id);
        if (!o) return null;
        return mapRow(row, {
          name: o.name,
          slug: o.slug,
          href: `/business/${o.slug}`,
          imageUrl: o.imageUrl,
        });
      }
      if (row.owner_type === "professional") {
        const o = professionalMap.get(row.owner_id);
        if (!o) return null;
        return mapRow(row, {
          name: o.name,
          slug: o.slug,
          href: `/professional/${o.slug}`,
          imageUrl: o.imageUrl,
        });
      }
      return mapRow(row);
    })
    .filter((x): x is EntityUpdate => Boolean(x));
}

/** Active updates for one owner (profile section). */
export async function listOwnerUpdates(
  client: SupabaseClient,
  ownerType: UpdateOwnerType,
  ownerId: string,
): Promise<EntityUpdate[]> {
  const { data, error } = await untyped(client)
    .from("entity_updates")
    .select(SELECT)
    .eq("owner_type", ownerType)
    .eq("owner_id", ownerId)
    .eq("status", "active")
    .order("published_at", { ascending: false })
    .limit(40);
  if (error || !data) return [];
  return (data as unknown as UpdateRow[]).map((row) => mapRow(row));
}

/** Public feed of active updates. */
export async function listPublicUpdates(
  client: SupabaseClient,
  opts?: { limit?: number },
): Promise<EntityUpdate[]> {
  const { data, error } = await untyped(client)
    .from("entity_updates")
    .select(SELECT)
    .eq("status", "active")
    .order("published_at", { ascending: false })
    .limit(opts?.limit ?? 60);
  if (error || !data) return [];
  return resolveOwners(client, data as unknown as UpdateRow[]);
}

/** Updates from entities the user follows. */
export async function listFollowedUpdates(
  client: SupabaseClient,
  userId: string,
  opts?: { limit?: number },
): Promise<EntityUpdate[]> {
  const { data: follows, error: followError } = await untyped(client)
    .from("entity_follows")
    .select("owner_type, owner_id")
    .eq("user_id", userId)
    .limit(200);
  if (followError || !follows?.length) return [];

  const pairs = follows as Array<{
    owner_type: UpdateOwnerType;
    owner_id: string;
  }>;
  const businessIds = pairs
    .filter((p) => p.owner_type === "business")
    .map((p) => p.owner_id);
  const professionalIds = pairs
    .filter((p) => p.owner_type === "professional")
    .map((p) => p.owner_id);

  const rows: UpdateRow[] = [];
  if (businessIds.length) {
    const { data } = await untyped(client)
      .from("entity_updates")
      .select(SELECT)
      .eq("owner_type", "business")
      .eq("status", "active")
      .in("owner_id", businessIds)
      .order("published_at", { ascending: false })
      .limit(opts?.limit ?? 60);
    rows.push(...((data as unknown as UpdateRow[]) ?? []));
  }
  if (professionalIds.length) {
    const { data } = await untyped(client)
      .from("entity_updates")
      .select(SELECT)
      .eq("owner_type", "professional")
      .eq("status", "active")
      .in("owner_id", professionalIds)
      .order("published_at", { ascending: false })
      .limit(opts?.limit ?? 60);
    rows.push(...((data as unknown as UpdateRow[]) ?? []));
  }

  rows.sort(
    (a, b) =>
      Date.parse(b.published_at) - Date.parse(a.published_at),
  );
  return resolveOwners(client, rows.slice(0, opts?.limit ?? 60));
}

/** Whether the user follows this owner. */
export async function isFollowingOwner(
  client: SupabaseClient,
  userId: string,
  ownerType: UpdateOwnerType,
  ownerId: string,
): Promise<boolean> {
  const { data } = await untyped(client)
    .from("entity_follows")
    .select("user_id")
    .eq("user_id", userId)
    .eq("owner_type", ownerType)
    .eq("owner_id", ownerId)
    .maybeSingle();
  return Boolean(data);
}

/** Insert missing updates for an owner (dedupe by title). */
export async function addMissingEntityUpdates(
  client: SupabaseClient,
  ownerType: UpdateOwnerType,
  ownerId: string,
  updates: QueueUpdate[],
  opts?: { source?: UpdateSource; sourceUrl?: string | null },
): Promise<number> {
  if (!updates.length) return 0;
  const db = untyped(client);
  const { data: existing } = await db
    .from("entity_updates")
    .select("title")
    .eq("owner_type", ownerType)
    .eq("owner_id", ownerId);
  const taken = new Set(
    ((existing ?? []) as Array<{ title: string }>).map((r) =>
      r.title.toLowerCase().trim(),
    ),
  );
  let added = 0;
  for (const update of updates) {
    const title = (update.title || "").trim().slice(0, 160);
    if (!title) continue;
    const key = title.toLowerCase();
    if (taken.has(key)) continue;
    taken.add(key);
    const { error } = await db.from("entity_updates").insert({
      owner_type: ownerType,
      owner_id: ownerId,
      title,
      body: update.body?.trim().slice(0, 4000) || null,
      status: "active",
      source: opts?.source ?? "import",
      source_url: update.source_url ?? opts?.sourceUrl ?? null,
      published_at: new Date().toISOString(),
    });
    if (!error) added += 1;
  }
  return added;
}
