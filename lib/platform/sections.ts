/**
 * Five platform sections on the home page (not business categories).
 * Business categories (restaurants, beauty, …) live only on /search.
 */

export type PlatformSectionKey =
  | "businesses"
  | "marketplace"
  | "services"
  | "lechu"
  | "transfers";

export type PlatformSectionPin =
  | "businesses"
  | "listings"
  | "services"
  | "lechu"
  | "transfers";

export type PlatformSection = {
  key: PlatformSectionKey;
  title: string;
  href: string;
  pin: PlatformSectionPin;
  hint: string;
  unitOne: string;
  unitFew: string;
  unitMany: string;
};

export const PLATFORM_SECTIONS: readonly PlatformSection[] = [
  {
    key: "businesses",
    title: "Бизнесы",
    href: "/search",
    pin: "businesses",
    hint: "компании в каталоге",
    unitOne: "компания",
    unitFew: "компании",
    unitMany: "компаний",
  },
  {
    key: "marketplace",
    title: "Marketplace",
    href: "/marketplace",
    pin: "listings",
    hint: "товары и объявления",
    unitOne: "объявление",
    unitFew: "объявления",
    unitMany: "объявлений",
  },
  {
    key: "services",
    title: "Услуги",
    href: "/services",
    pin: "services",
    hint: "мастера и сервисы",
    unitOne: "услуга",
    unitFew: "услуги",
    unitMany: "услуг",
  },
  {
    key: "lechu",
    title: "Лечу",
    href: "/lechu",
    pin: "lechu",
    hint: "кто летит и везёт",
    unitOne: "маршрут",
    unitFew: "маршрута",
    unitMany: "маршрутов",
  },
  {
    key: "transfers",
    title: "Переводы",
    href: "/transfers",
    pin: "transfers",
    hint: "деньги между странами",
    unitOne: "предложение",
    unitFew: "предложения",
    unitMany: "предложений",
  },
] as const;

export type PlatformSectionCounts = Record<PlatformSectionKey, number>;

export function emptyPlatformSectionCounts(): PlatformSectionCounts {
  return {
    businesses: 0,
    marketplace: 0,
    services: 0,
    lechu: 0,
    transfers: 0,
  };
}

/** Quick filters on /search — not home hubs. */
export const BUSINESS_QUICK_FILTERS = [
  { slug: "restaurants", label: "Еда" },
  { slug: "auto", label: "Авто" },
  { slug: "beauty", label: "Красота" },
  { slug: "medical", label: "Медицина" },
] as const;
