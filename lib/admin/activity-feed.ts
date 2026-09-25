import type { SupabaseClient } from "@supabase/supabase-js";
import { REGION_HUBS, USA_OVERVIEW_HUB } from "@/lib/regions/hubs";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export const ACTIVITY_KINDS = [
  "page_view",
  "search",
  "click",
  "contact_reveal",
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export type ActivityFeedItem = {
  id: string;
  at: string;
  kind: ActivityKind;
  actorId: string | null;
  actorName: string;
  actorHandle: string | null;
  action: string;
  detail: string;
  path: string;
};

const SECTION_LABEL: Record<string, string> = {
  search: "Поиск",
  map: "Карта",
  businesses: "Бизнесы",
  business: "Карточка",
  professionals: "Специалисты",
  professional: "Специалист",
  marketplace: "Объявления",
  services: "Услуги",
  lechu: "Лечу",
  transfers: "Переводы",
  jobs: "Работа",
  events: "События",
  churches: "Церкви",
  promotions: "Акции",
  coupons: "Купоны",
  updates: "Обновления",
  vehicles: "Транспорт",
  "real-estate": "Недвижимость",
  games: "Игры",
  profile: "Профиль",
  me: "Кабинет",
  login: "Вход",
  register: "Регистрация",
  "add-business": "Добавить бизнес",
  u: "Профиль человека",
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function hubName(id: string | null): string | null {
  if (!id) return null;
  if (id === "usa-overview") return USA_OVERVIEW_HUB.inLabel;
  if (Object.prototype.hasOwnProperty.call(REGION_HUBS, id)) {
    return REGION_HUBS[id as keyof typeof REGION_HUBS].inLabel;
  }
  return null;
}

function describePath(path: string, names: Map<string, string>): string {
  const [pathname, search = ""] = path.split("?");
  const params = new URLSearchParams(search);
  const parts = pathname.split("/").filter(Boolean);
  const hub = hubName(params.get("hub"));
  const query = params.get("q");

  let place = "Главная";
  if (parts[0] === "business" && parts[1]) {
    const name = names.get(parts[1]) ?? parts[1];
    place =
      parts[2] === "offers" && parts[3]
        ? `Оффер «${decodeURIComponent(parts[3])}» у «${name}»`
        : `Карточка «${name}»`;
  } else if (parts[0] === "u" && parts[1]) {
    place = `Профиль @${decodeURIComponent(parts[1])}`;
  } else if (parts[0] === "professional" && parts[1]) {
    place = `Специалист «${decodeURIComponent(parts[1])}»`;
  } else if (parts[0] === "search") {
    place = query ? `Поиск «${query}»` : "Страница поиска";
  } else if (parts[0]) {
    const section = SECTION_LABEL[parts[0]] ?? `/${parts[0]}`;
    place = parts[1]
      ? `${section} «${decodeURIComponent(parts[1])}»`
      : section;
  }

  if (hub && parts[0] !== "search") {
    place = `${place} · ${hub}`;
  }
  return place;
}

function businessSlug(path: string, meta: Record<string, unknown>): string | null {
  const fromMeta = text(meta.business_slug);
  if (fromMeta) return fromMeta;
  const [pathname] = path.split("?");
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "business" && parts[1]) return decodeURIComponent(parts[1]);
  return null;
}

export function describeActivity(
  kind: ActivityKind,
  path: string,
  meta: Record<string, unknown>,
  names: Map<string, string>,
): { action: string; detail: string } {
  const place = describePath(path, names);
  if (kind === "search") {
    return { action: "Поиск", detail: text(meta.q) ?? place };
  }
  if (kind === "contact_reveal") {
    const slug = businessSlug(path, meta);
    const name = (slug && names.get(slug)) || text(meta.business_slug) || place;
    const offer = text(meta.offer_slug);
    return {
      action: "Контакты",
      detail: offer ? `«${name}» · оффер ${offer}` : `«${name}»`,
    };
  }
  if (kind === "click") {
    const label = text(meta.label);
    const surface = text(meta.surface);
    if (surface === "ui" && label) {
      const href = text(meta.href);
      return {
        action: "Нажатие",
        detail: href ? `«${label}» → ${href}` : `«${label}» · ${place}`,
      };
    }
    const entity = text(meta.entity_type);
    const entityLabel =
      entity === "business"
        ? "бизнес"
        : entity === "marketplace"
          ? "объявление"
          : entity === "service"
            ? "услугу"
            : entity === "lechu"
              ? "«Лечу»"
              : entity === "transfer"
                ? "перевод"
                : "карточку";
    return { action: "Открытие", detail: `${entityLabel} · ${place}` };
  }
  return { action: "Заход", detail: place };
}

function isKind(value: string | undefined): value is ActivityKind {
  return ACTIVITY_KINDS.includes(value as ActivityKind);
}

export async function getAdminActivityFeed(
  client: Client,
  filters: { kind?: string; actor?: string },
): Promise<{ items: ActivityFeedItem[]; actorName: string | null }> {
  let query = client
    .from("platform_events")
    .select("id, event_type, path, user_id, meta, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (isKind(filters.kind)) {
    query = query.eq("event_type", filters.kind);
  }
  if (filters.actor) {
    query = query.eq("user_id", filters.actor);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = data ?? [];
  const userIds = [
    ...new Set(rows.map((row) => row.user_id).filter((id): id is string => Boolean(id))),
  ];
  const names = new Map<string, string>();
  const handles = new Map<string, string | null>();

  if (userIds.length > 0) {
    const { data: profiles } = await client
      .from("profiles")
      .select("id, display_name, username")
      .in("id", userIds);
    for (const profile of profiles ?? []) {
      names.set(
        profile.id,
        profile.display_name?.trim() ||
          (profile.username ? `@${profile.username}` : "Без имени"),
      );
      handles.set(profile.id, profile.username);
    }
  }

  const slugs = new Set<string>();
  for (const row of rows) {
    const slug = businessSlug(row.path, asRecord(row.meta));
    if (slug) slugs.add(slug);
  }
  const businessNames = new Map<string, string>();
  if (slugs.size > 0) {
    const { data: businesses } = await client
      .from("businesses")
      .select("slug, name")
      .in("slug", [...slugs]);
    for (const business of businesses ?? []) {
      if (business.slug && business.name) {
        businessNames.set(business.slug, business.name);
      }
    }
  }

  const items = rows.map((row) => {
    const meta = asRecord(row.meta);
    const described = describeActivity(row.event_type, row.path, meta, businessNames);
    const actorId = row.user_id;
    return {
      id: row.id,
      at: row.created_at,
      kind: row.event_type,
      actorId,
      actorName: actorId ? (names.get(actorId) ?? "Пользователь") : "Гость",
      actorHandle: actorId ? (handles.get(actorId) ?? null) : null,
      action: described.action,
      detail: described.detail,
      path: row.path,
    };
  });

  const actorName =
    filters.actor && items[0]
      ? items[0].actorName
      : filters.actor
        ? (names.get(filters.actor) ?? null)
        : null;

  return { items, actorName };
}
