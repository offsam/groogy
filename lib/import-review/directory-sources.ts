export type DirectorySourceId =
  | "orange_pages"
  | "russian_seattle"
  | "svoi"
  | "boston_pages"
  | "zerkalo_mn"
  | "ruspagesusa"
  | "to4ka"
  | "slavic_seattle"
  | "our_texas"
  | "echoru"
  | "bazar_club"
  | "russian_bazaar";

export type DirectorySourceMeta = {
  id: DirectorySourceId;
  slug: string;
  title: string;
  shortTitle: string;
  description: string;
  homepage: string;
  regionHint: string;
};

export const DIRECTORY_SOURCES: Record<DirectorySourceId, DirectorySourceMeta> =
  {
    orange_pages: {
      id: "orange_pages",
      slug: "orange-pages",
      title: "Russian Orange Pages",
      shortTitle: "Orange Pages",
      description:
        "Сервисы Orange County / Southern California с russianorangepages.com",
      homepage: "https://www.russianorangepages.com/community/",
      regionHint: "Orange County",
    },
    russian_seattle: {
      id: "russian_seattle",
      slug: "russian-seattle",
      title: "Russian Seattle",
      shortTitle: "Russian Seattle",
      description:
        "Yellow Pages russianseattle.com (сеть Russian America)",
      homepage: "https://www.russianseattle.com/yellow_r.htm",
      regionHint: "Seattle",
    },
    svoi: {
      id: "svoi",
      slug: "svoi",
      title: "Svoi.us",
      shortTitle: "Svoi.us",
      description:
        "Крупный RU-каталог бизнесов США (NYC, Чикаго, LA и др.)",
      homepage: "https://svoi.us/companies",
      regionHint: "USA",
    },
    boston_pages: {
      id: "boston_pages",
      slug: "boston-pages",
      title: "Boston Russian Pages",
      shortTitle: "Boston Pages",
      description:
        "Каталог русскоязычного бизнеса Новой Англии (bostonrussianpages.com)",
      homepage: "https://bostonrussianpages.com/yellowpages",
      regionHint: "New England",
    },
    zerkalo_mn: {
      id: "zerkalo_mn",
      slug: "zerkalo-mn",
      title: "Zerkalo Minnesota",
      shortTitle: "Zerkalo MN",
      description:
        "Russian Yellow Pages Миннесоты (zerkalomn.com)",
      homepage: "https://www.zerkalomn.com/yellow-pages1.html",
      regionHint: "Minnesota",
    },
    ruspagesusa: {
      id: "ruspagesusa",
      slug: "ruspagesusa",
      title: "RusPagesUSA",
      shortTitle: "RusPagesUSA",
      description:
        "Национальный каталог ruspagesusa.com (карточки компаний)",
      homepage: "https://ruspagesusa.com/catalog/",
      regionHint: "USA",
    },
    to4ka: {
      id: "to4ka",
      slug: "to4ka",
      title: "to4ka.us",
      shortTitle: "to4ka",
      description:
        "Каталог «Бизнес и услуги» to4ka.us (объявления по США)",
      homepage: "https://to4ka.us/catalog/all-usa",
      regionHint: "USA",
    },
    slavic_seattle: {
      id: "slavic_seattle",
      slug: "slavic-seattle",
      title: "Slavic Seattle",
      shortTitle: "Slavic Seattle",
      description:
        "Каталог русскоязычных бизнесов Вашингтона (slavicseattle.com)",
      homepage: "https://slavicseattle.com/businesses",
      regionHint: "Washington",
    },
    our_texas: {
      id: "our_texas",
      slug: "our-texas",
      title: "Our Texas",
      shortTitle: "Our Texas",
      description:
        "Бизнес-справочник газеты «Наш Техас» (ourtx.com/yellow-pages)",
      homepage: "https://ourtx.com/yellow-pages",
      regionHint: "Texas",
    },
    echoru: {
      id: "echoru",
      slug: "echoru",
      title: "EchoRU",
      shortTitle: "EchoRU",
      description:
        "Справочник русских бизнесов LA / San Diego / Phoenix (echoru.com)",
      homepage: "https://www.echoru.com/russian-business-directory/",
      regionHint: "SoCal / Arizona",
    },
    bazar_club: {
      id: "bazar_club",
      slug: "bazar-club",
      title: "BAZAR.club",
      shortTitle: "BAZAR.club",
      description:
        "Каталог услуг и бизнесов bazar.club (пилот обогащения)",
      homepage: "https://www.bazar.club/business",
      regionHint: "USA",
    },
    russian_bazaar: {
      id: "russian_bazaar",
      slug: "russian-bazaar",
      title: "Русский базар",
      shortTitle: "Русский базар",
      description:
        "Объявления услуг russian-bazaar.com (пилот обогащения)",
      homepage: "http://russian-bazaar.com/ru/ad-view-cat.htm",
      regionHint: "NY / USA",
    },
  };

export const DIRECTORY_SOURCE_LIST = Object.values(DIRECTORY_SOURCES);

export function directorySourceBySlug(
  slug: string,
): DirectorySourceMeta | null {
  return DIRECTORY_SOURCE_LIST.find((s) => s.slug === slug) ?? null;
}

export function directorySourceHref(slug: string, status?: string) {
  const base = `/admin/directories/${slug}`;
  if (!status || status === "pending") return base;
  return `${base}?status=${encodeURIComponent(status)}`;
}
