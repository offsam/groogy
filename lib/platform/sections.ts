/**
 * Nine platform hubs on the home page (not business leaf categories).
 * Leaf categories (restaurants, beauty, …) live under /search.
 */

export type PlatformSectionKey =
  | "businesses"
  | "professionals"
  | "marketplace"
  | "jobs"
  | "real_estate"
  | "events"
  | "vehicles"
  | "lechu"
  | "transfers"
  | "churches"
  | "coupons";

export type PlatformSectionPin =
  | "businesses"
  | "professionals"
  | "listings"
  | "jobs"
  | "real_estate"
  | "events"
  | "auto"
  | "lechu"
  | "transfers"
  | "churches"
  | "promos";

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
    key: "professionals",
    title: "Специалисты",
    href: "/professionals",
    pin: "professionals",
    hint: "мастера и профи",
    unitOne: "специалист",
    unitFew: "специалиста",
    unitMany: "специалистов",
  },
  {
    key: "marketplace",
    title: "Купи-продай",
    href: "/marketplace",
    pin: "listings",
    hint: "товары и объявления",
    unitOne: "объявление",
    unitFew: "объявления",
    unitMany: "объявлений",
  },
  {
    key: "jobs",
    title: "Работа",
    href: "/jobs",
    pin: "jobs",
    hint: "вакансии и поиск работы",
    unitOne: "вакансия",
    unitFew: "вакансии",
    unitMany: "вакансий",
  },
  {
    key: "real_estate",
    title: "Недвижимость",
    href: "/real-estate",
    pin: "real_estate",
    hint: "аренда и продажа",
    unitOne: "объект",
    unitFew: "объекта",
    unitMany: "объектов",
  },
  {
    key: "events",
    title: "События",
    href: "/events",
    pin: "events",
    hint: "встречи и мероприятия",
    unitOne: "событие",
    unitFew: "события",
    unitMany: "событий",
  },
  {
    key: "vehicles",
    title: "Авто",
    href: "/vehicles",
    pin: "auto",
    hint: "машины и транспорт",
    unitOne: "объявление",
    unitFew: "объявления",
    unitMany: "объявлений",
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
  {
    key: "churches",
    title: "Церкви",
    href: "/churches",
    pin: "churches",
    hint: "приходы и общины",
    unitOne: "церковь",
    unitFew: "церкви",
    unitMany: "церквей",
  },
  {
    key: "coupons",
    title: "Купонинг",
    href: "/coupons",
    pin: "promos",
    hint: "скидки и акции",
    unitOne: "акция",
    unitFew: "акции",
    unitMany: "акций",
  },
] as const;

export type PlatformSectionCounts = Record<PlatformSectionKey, number>;

export function emptyPlatformSectionCounts(): PlatformSectionCounts {
  return {
    businesses: 0,
    professionals: 0,
    marketplace: 0,
    jobs: 0,
    real_estate: 0,
    events: 0,
    vehicles: 0,
    lechu: 0,
    transfers: 0,
    churches: 0,
    coupons: 0,
  };
}

/** Quick filters on /search — not home hubs. */
export const BUSINESS_QUICK_FILTERS = [
  { slug: "restaurants", label: "Еда" },
  { slug: "auto", label: "Авто" },
  { slug: "beauty", label: "Красота" },
  { slug: "medical", label: "Медицина" },
] as const;
