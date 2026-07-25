import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { searchBusinesses } from "@/lib/supabase/queries";
import {
  searchLechuListings,
  searchMarketplaceListings,
  searchServiceListings,
  searchTransferListings,
} from "@/lib/listings/queries";

export type HubCategoryCounts = {
  businesses: number;
  marketplace: number;
  services: number;
  lechu: number;
  transfers: number;
  food: number;
  auto: number;
  jobs: number;
};

export const HUB_CATEGORY_COUNT_ITEMS = [
  {
    key: "businesses",
    title: "Бизнесы",
    href: "/search",
    hint: "компании в каталоге",
    unitOne: "компания",
    unitFew: "компании",
    unitMany: "компаний",
  },
  {
    key: "marketplace",
    title: "Marketplace",
    href: "/marketplace",
    hint: "товары и объявления",
    unitOne: "объявление",
    unitFew: "объявления",
    unitMany: "объявлений",
  },
  {
    key: "services",
    title: "Услуги",
    href: "/services",
    hint: "мастера и сервисы",
    unitOne: "услуга",
    unitFew: "услуги",
    unitMany: "услуг",
  },
  {
    key: "lechu",
    title: "Лечу",
    href: "/lechu",
    hint: "кто летит и везёт",
    unitOne: "маршрут",
    unitFew: "маршрута",
    unitMany: "маршрутов",
  },
  {
    key: "transfers",
    title: "Переводы",
    href: "/transfers",
    hint: "деньги между странами",
    unitOne: "предложение",
    unitFew: "предложения",
    unitMany: "предложений",
  },
  {
    key: "food",
    title: "Еда",
    href: "/search?category=restaurants",
    hint: "кафе и рестораны",
    unitOne: "место",
    unitFew: "места",
    unitMany: "мест",
  },
  {
    key: "auto",
    title: "Авто",
    href: "/search?category=auto",
    hint: "сервис и продажи",
    unitOne: "компания",
    unitFew: "компании",
    unitMany: "компаний",
  },
  {
    key: "jobs",
    title: "Работа",
    href: "/search?q=работа",
    hint: "вакансии рядом",
    unitOne: "вакансия",
    unitFew: "вакансии",
    unitMany: "вакансий",
  },
] as const satisfies ReadonlyArray<{
  key: keyof HubCategoryCounts;
  title: string;
  href: string;
  hint: string;
  unitOne: string;
  unitFew: string;
  unitMany: string;
}>;

function emptyCounts(): HubCategoryCounts {
  return {
    businesses: 0,
    marketplace: 0,
    services: 0,
    lechu: 0,
    transfers: 0,
    food: 0,
    auto: 0,
    jobs: 0,
  };
}

export async function getHubCategoryCounts(
  hubId: string,
): Promise<HubCategoryCounts> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return emptyCounts();

  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [
    businesses,
    marketplace,
    services,
    lechu,
    transfers,
    food,
    auto,
    jobs,
  ] = await Promise.all([
    searchBusinesses(client, { hubId }).then((rows) => rows.length),
    searchMarketplaceListings(client, { hubId, page: 1, pageSize: 1 }).then(
      (r) => r.total,
    ),
    searchServiceListings(client, { hubId, page: 1, pageSize: 1 }).then(
      (r) => r.total,
    ),
    searchLechuListings(client, { hubId, page: 1, pageSize: 1 }).then(
      (r) => r.total,
    ),
    searchTransferListings(client, { hubId, page: 1, pageSize: 1 }).then(
      (r) => r.total,
    ),
    searchBusinesses(client, { hubId, categorySlug: "restaurants" }).then(
      (rows) => rows.length,
    ),
    searchBusinesses(client, { hubId, categorySlug: "auto" }).then(
      (rows) => rows.length,
    ),
    searchBusinesses(client, { hubId, query: "работа" }).then(
      (rows) => rows.length,
    ),
  ]);

  return {
    businesses,
    marketplace,
    services,
    lechu,
    transfers,
    food,
    auto,
    jobs,
  };
}
