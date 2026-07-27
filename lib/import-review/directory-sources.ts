export type DirectorySourceId =
  | "orange_pages"
  | "russian_seattle"
  | "svoi"
  | "boston_pages"
  | "zerkalo_mn"
  | "ruspagesusa";

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
