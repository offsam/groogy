import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminUsers } from "@/lib/admin/queries";
import { getParseResourceCategories } from "@/lib/import-review/parse-resources";
import type { AdminSectionId } from "@/lib/admin/sections";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;
// Catalog tables exist in the database but are not all in the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = SupabaseClient<any>;

export type AdminSearchHit = {
  id: string;
  title: string;
  hint: string;
  href: string;
};

function loose(client: Client): Loose {
  return client as Loose;
}

function safeQuery(raw: string): string {
  return raw.trim().replace(/[%_,]/g, "").slice(0, 80);
}

function like(q: string): string {
  return `%${q}%`;
}

export async function searchAdminSection(
  client: Client,
  section: AdminSectionId,
  rawQuery: string,
): Promise<AdminSearchHit[]> {
  const q = safeQuery(rawQuery);
  if (q.length < 2) return [];
  if (section === "cards") return searchBusinesses(client, q, "any");
  if (section === "catalog") return searchCatalog(client, q);
  if (section === "people") return searchPeople(client, q);
  if (section === "activity") return searchActivity(client, q);
  return searchSystem(client, q);
}

async function searchBusinesses(
  client: Client,
  q: string,
  scope: "any" | "published",
): Promise<AdminSearchHit[]> {
  let query = client
    .from("businesses")
    .select("id, name, city, slug, status")
    .or(`name.ilike.${like(q)},city.ilike.${like(q)},slug.ilike.${like(q)}`)
    .limit(12);
  if (scope === "published") query = query.eq("status", "approved");
  const { data } = await query;
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.name,
    hint: [row.city, row.status === "approved" ? "в каталоге" : row.status]
      .filter(Boolean)
      .join(" · "),
    href: `/admin/businesses/${row.id}/edit`,
  }));
}

async function searchCatalog(client: Client, q: string): Promise<AdminSearchHit[]> {
  const pattern = like(q);
  const [businesses, professionals, churches, events, jobs] = await Promise.all([
    searchBusinesses(client, q, "published"),
    loose(client)
      .from("professionals")
      .select("id, display_name, slug, city")
      .or(`display_name.ilike.${pattern},slug.ilike.${pattern},city.ilike.${pattern}`)
      .limit(8),
    loose(client)
      .from("churches")
      .select("id, name, city, slug")
      .or(`name.ilike.${pattern},slug.ilike.${pattern},city.ilike.${pattern}`)
      .limit(8),
    loose(client)
      .from("events")
      .select("id, title, city, slug")
      .or(`title.ilike.${pattern},slug.ilike.${pattern},city.ilike.${pattern}`)
      .limit(8),
    loose(client)
      .from("jobs")
      .select("id, title, city, slug")
      .or(`title.ilike.${pattern},slug.ilike.${pattern},city.ilike.${pattern}`)
      .limit(8),
  ]);

  const hits: AdminSearchHit[] = [...businesses];
  for (const row of professionals.data ?? []) {
    hits.push({
      id: row.id,
      title: row.display_name || row.slug,
      hint: ["специалист", row.city].filter(Boolean).join(" · "),
      href: row.slug ? `/professional/${row.slug}/edit` : "/admin/catalog/professionals",
    });
  }
  for (const row of churches.data ?? []) {
    hits.push({
      id: row.id,
      title: row.name,
      hint: ["церковь", row.city].filter(Boolean).join(" · "),
      href: `/admin/catalog/churches/${row.id}/edit`,
    });
  }
  for (const row of events.data ?? []) {
    hits.push({
      id: row.id,
      title: row.title,
      hint: ["событие", row.city].filter(Boolean).join(" · "),
      href: "/admin/catalog/events",
    });
  }
  for (const row of jobs.data ?? []) {
    hits.push({
      id: row.id,
      title: row.title,
      hint: ["вакансия", row.city].filter(Boolean).join(" · "),
      href: "/admin/catalog/jobs",
    });
  }
  return hits.slice(0, 24);
}

async function searchPeople(client: Client, q: string): Promise<AdminSearchHit[]> {
  const needle = q.toLowerCase();
  const users = await getAdminUsers(client);
  return users
    .filter((user) => {
      const hay = [user.display_name, user.email, user.id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    })
    .slice(0, 20)
    .map((user) => ({
      id: user.id,
      title: user.display_name || user.email || "Без имени",
      hint: [user.email, user.role].filter(Boolean).join(" · "),
      href: "/admin/users",
    }));
}

async function searchActivity(client: Client, q: string): Promise<AdminSearchHit[]> {
  const pattern = like(q);
  const { data } = await client
    .from("platform_events")
    .select("id, event_type, path, created_at, meta")
    .or(`path.ilike.${pattern}`)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []).map((row) => {
    const meta = row.meta as Record<string, unknown> | null;
    const label = typeof meta?.label === "string" ? meta.label : null;
    const query = typeof meta?.q === "string" ? meta.q : null;
    return {
      id: row.id,
      title: label || query || row.path,
      hint: `${row.event_type} · ${new Date(row.created_at).toLocaleString("ru-RU")}`,
      href: `/admin/analytics?kind=${row.event_type}`,
    };
  });
}

async function searchSystem(client: Client, q: string): Promise<AdminSearchHit[]> {
  const needle = q.toLowerCase();
  const pattern = like(q);
  const [categories, errors] = await Promise.all([
    client.from("categories").select("id, name, name_en, slug").or(
      `name.ilike.${pattern},name_en.ilike.${pattern},slug.ilike.${pattern}`,
    ).limit(8),
    client
      .from("platform_error_reports")
      .select("id, message, page_path, created_at")
      .ilike("message", pattern)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const hits: AdminSearchHit[] = [];
  for (const row of categories.data ?? []) {
    hits.push({
      id: row.id,
      title: row.name || row.name_en || row.slug,
      hint: "категория",
      href: "/admin/system/taxonomy",
    });
  }
  for (const row of errors.data ?? []) {
    hits.push({
      id: row.id,
      title: row.message.slice(0, 120),
      hint: row.page_path || "ошибка",
      href: "/admin/system/error-reports",
    });
  }
  for (const group of getParseResourceCategories()) {
    if (group.title.toLowerCase().includes(needle)) {
      hits.push({
        id: group.id,
        title: group.title,
        hint: "источник",
        href: `/admin/sources/${group.id}`,
      });
    }
    for (const item of group.items) {
      const name = item.title;
      if (!name.toLowerCase().includes(needle)) continue;
      hits.push({
        id: `${group.id}-${name}`,
        title: name,
        hint: group.title,
        href: `/admin/sources/${group.id}`,
      });
    }
  }
  return hits.slice(0, 24);
}
