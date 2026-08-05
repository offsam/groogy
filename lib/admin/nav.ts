/**
 * Admin navigation — only live, needed sections.
 * Queue = cards waiting for publish; sources = filters over that queue.
 */

export type AdminNavItem = {
  id: string;
  label: string;
  href: string;
  comingSoon?: boolean;
  legacyHref?: string;
  description?: string;
};

export type AdminNavSection = {
  id: string;
  label: string;
  href?: string;
  comingSoon?: boolean;
  children?: AdminNavItem[];
};

/** Sidebar — practical sections only */
export const ADMIN_NAV: AdminNavSection[] = [
  {
    id: "dashboard",
    label: "Главная",
    href: "/admin",
  },
  {
    id: "queue",
    label: "Очередь",
    href: "/admin/review/inbox",
    children: [
      {
        id: "queue-feed",
        label: "Вся лента",
        href: "/admin/review/inbox",
        description:
          "Полосы разбора → каталог: прикрепить, разложить, готово, я ищу, помойка",
      },
      {
        id: "queue-ready",
        label: "Готово → OK",
        href: "/admin/review/inbox?view=lane_ready",
        description: "Можно выкладывать одним кликом",
      },
      {
        id: "queue-attach",
        label: "Прикрепить",
        href: "/admin/review/inbox?view=lane_attach",
        description: "Рекомендации к живым карточкам",
      },
      {
        id: "queue-quarantine",
        label: "Помойка",
        href: "/admin/review/inbox?view=lane_quarantine",
        description: "Карантин: вернуть или уничтожить",
      },
      {
        id: "queue-telegram",
        label: "Telegram",
        href: "/admin/review/inbox?view=telegram&source=telegram",
        description: "Очередь только из Telegram",
      },
      {
        id: "queue-facebook",
        label: "Facebook",
        href: "/admin/review/inbox?view=facebook&source=facebook",
        description: "Очередь только из Facebook",
      },
      {
        id: "queue-directories",
        label: "Справочники",
        href: "/admin/review/inbox?view=directories&source=directories",
        description: "Yellow Pages и другие справочники",
      },
      {
        id: "queue-loveoverse",
        label: "Loveoverse",
        href: "/admin/review/inbox?view=loveoverse&source=loveoverse",
        description: "Афиша loveoverse.com (события LA)",
      },
      {
        id: "queue-wrong-section",
        label: "Не тот раздел",
        href: "/admin/review/wrong-section",
        description: "Опубликованные карточки не в своём разделе",
      },
      {
        id: "queue-business-to-professional",
        label: "Бизнесы → Специалисты",
        href: "/admin/review/business-to-professional",
        description: "Бизнесы, названные как человек — кандидаты на перенос",
      },
    ],
  },
  {
    id: "users",
    label: "Пользователи",
    href: "/admin/users",
  },
  {
    id: "errors",
    label: "Ошибки",
    href: "/admin/system/error-reports",
  },
  {
    id: "claims",
    label: "Верификация",
    href: "/admin/claims",
  },
  {
    id: "catalog",
    label: "Каталог",
    href: "/admin/catalog",
    children: [
      {
        id: "catalog-businesses",
        label: "Бизнесы",
        href: "/admin/catalog/businesses",
        legacyHref: "/admin/businesses",
        description: "Штат · округ · категория · Edit",
      },
      {
        id: "catalog-professionals",
        label: "Специалисты",
        href: "/admin/catalog/professionals",
      },
      {
        id: "catalog-marketplace",
        label: "Marketplace",
        href: "/admin/catalog/marketplace",
        legacyHref: "/admin/listings?domain=marketplace",
      },
      {
        id: "catalog-jobs",
        label: "Вакансии",
        href: "/admin/catalog/jobs",
      },
      {
        id: "catalog-events",
        label: "События",
        href: "/admin/catalog/events",
      },
      {
        id: "catalog-churches",
        label: "Церкви",
        href: "/admin/catalog/churches",
        description: "Церкви и приходы",
      },
    ],
  },
  {
    id: "reviews",
    label: "Отзывы",
    href: "/admin/community/reviews",
  },
  {
    id: "taxonomy",
    label: "Категории",
    href: "/admin/system/taxonomy",
  },
];

/** Legacy URL → current home (docs / redirects). */
export const ADMIN_LEGACY_MAPPING: Array<{
  legacy: string;
  ia: string;
  note: string;
}> = [
  { legacy: "/admin", ia: "/admin", note: "Главная" },
  {
    legacy: "/admin/import-review",
    ia: "/admin/review/inbox",
    note: "→ Очередь",
  },
  {
    legacy: "/admin/import-review/[id]",
    ia: "/admin/review/[taskId]",
    note: "→ Карточка в очереди",
  },
  { legacy: "/admin/claims", ia: "/admin/claims", note: "Верификация" },
  {
    legacy: "/admin/events",
    ia: "/admin/review/inbox?view=events",
    note: "→ Очередь · события",
  },
  {
    legacy: "/admin/businesses",
    ia: "/admin/catalog/businesses",
    note: "→ Каталог",
  },
  {
    legacy: "/admin/listings",
    ia: "/admin/catalog/marketplace",
    note: "→ Каталог",
  },
  {
    legacy: "/admin/telegram-groups",
    ia: "/admin/review/inbox?view=telegram&source=telegram",
    note: "→ Очередь · Telegram",
  },
  {
    legacy: "/admin/directories",
    ia: "/admin/review/inbox?view=directories&source=directories",
    note: "→ Очередь · Справочники",
  },
  {
    legacy: "/admin/yellow-pages",
    ia: "/admin/review/inbox?view=directories&source=directories",
    note: "→ Очередь · Справочники",
  },
  {
    legacy: "/admin/recommendations",
    ia: "/admin/review/inbox",
    note: "→ Очередь",
  },
  {
    legacy: "/admin/reviews",
    ia: "/admin/community/reviews",
    note: "→ Отзывы",
  },
  { legacy: "/admin/users", ia: "/admin/users", note: "Пользователи" },
  {
    legacy: "/admin/master-data",
    ia: "/admin/system/taxonomy",
    note: "→ Категории",
  },
  {
    legacy: "/admin/system/error-reports",
    ia: "/admin/system/error-reports",
    note: "Ошибки",
  },
];

function searchHasSourceFilter(search: string): boolean {
  const have = new URLSearchParams(search);
  const view = have.get("view");
  const source = have.get("source");
  if (source && source !== "all") return true;
  if (
    view &&
    view !== "all" &&
    view !== "high_confidence" &&
    view !== "recently_imported"
  ) {
    return true;
  }
  return false;
}

/** Paths that should highlight a nav item (prefix / query match) */
export function matchAdminNavHref(
  pathname: string,
  search: string,
  href: string,
): boolean {
  if (href.includes("?")) {
    const [path, query] = href.split("?");
    if (pathname !== path) return false;
    const want = new URLSearchParams(query);
    const have = new URLSearchParams(search);
    for (const [k, v] of want.entries()) {
      if (have.get(k) !== v) return false;
    }
    return true;
  }

  if (pathname === href) {
    if (href === "/admin/review/inbox") {
      return !searchHasSourceFilter(search);
    }
    return true;
  }

  if (href === "/admin" && pathname === "/admin") return true;

  if (href === "/admin/review/inbox") {
    if (pathname.startsWith("/admin/import-review")) return true;
    if (
      pathname.startsWith("/admin/review/") &&
      pathname !== "/admin/review/views" &&
      !pathname.startsWith("/admin/review/wrong-section") &&
      !pathname.startsWith("/admin/review/business-to-professional") &&
      pathname !== "/admin/review/inbox"
    ) {
      return true;
    }
    return false;
  }

  if (href !== "/admin" && pathname.startsWith(href + "/")) return true;

  if (href === "/admin/claims" && pathname.startsWith("/admin/claims")) {
    return true;
  }
  if (
    href === "/admin/system/error-reports" &&
    pathname.startsWith("/admin/system/error-reports")
  ) {
    return true;
  }
  if (href === "/admin/catalog/businesses" && pathname.startsWith("/admin/businesses")) {
    return true;
  }
  if (
    href === "/admin/catalog/marketplace" &&
    pathname.startsWith("/admin/listings")
  ) {
    return true;
  }
  if (
    href === "/admin/community/reviews" &&
    pathname.startsWith("/admin/reviews")
  ) {
    return true;
  }
  if (
    href === "/admin/system/taxonomy" &&
    pathname.startsWith("/admin/master-data")
  ) {
    return true;
  }
  if (href === "/admin/users" && pathname.startsWith("/admin/users")) {
    return true;
  }
  return false;
}
