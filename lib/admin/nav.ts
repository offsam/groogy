/**
 * Admin Panel IA V2 — Phase 1 navigation shell.
 * Source of Truth: docs/architecture/ADMIN_PANEL_IA_V2.md
 *
 * Phase 1: nav + routes only. No queue/catalog logic migration.
 */

export type AdminNavItem = {
  id: string;
  label: string;
  href: string;
  /** If set, page is a placeholder */
  comingSoon?: boolean;
  /** Legacy URL that remains the real implementation */
  legacyHref?: string;
  description?: string;
};

export type AdminNavSection = {
  id: string;
  label: string;
  /** Section landing (optional) */
  href?: string;
  comingSoon?: boolean;
  children?: AdminNavItem[];
};

/** Sidebar tree — Phase 1 */
export const ADMIN_NAV: AdminNavSection[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/admin",
  },
  {
    id: "review",
    label: "Review Center",
    href: "/admin/review",
    children: [
      {
        id: "review-inbox",
        label: "Inbox",
        href: "/admin/review/inbox",
        legacyHref: "/admin/import-review",
        description: "Единая очередь задач (агрегатор)",
      },
      {
        id: "review-views",
        label: "Saved Views",
        href: "/admin/review/views",
        description: "Пресеты фильтров Inbox",
      },
    ],
  },
  {
    id: "catalog",
    label: "Catalog",
    href: "/admin/catalog",
    children: [
      {
        id: "catalog-businesses",
        label: "Businesses",
        href: "/admin/catalog/businesses",
        legacyHref: "/admin/businesses",
        description: "Каталог бизнесов",
      },
      {
        id: "catalog-professionals",
        label: "Professionals",
        href: "/admin/catalog/professionals",
        description: "Каталог специалистов",
      },
      {
        id: "catalog-marketplace",
        label: "Marketplace",
        href: "/admin/catalog/marketplace",
        legacyHref: "/admin/listings?domain=marketplace",
        description: "Каталог объявлений marketplace",
      },
      {
        id: "catalog-jobs",
        label: "Jobs",
        href: "/admin/catalog/jobs",
        description: "Каталог вакансий",
      },
      {
        id: "catalog-events",
        label: "Events",
        href: "/admin/catalog/events",
        description: "Каталог опубликованных событий",
      },
    ],
  },
  {
    id: "imports",
    label: "Imports",
    href: "/admin/imports",
    children: [
      {
        id: "imports-telegram",
        label: "Telegram",
        href: "/admin/imports/telegram",
        legacyHref: "/admin/telegram-groups",
        description: "История и диагностика Telegram-групп",
      },
      {
        id: "imports-telegram-new",
        label: "Telegram · новое",
        href: "/admin/imports/telegram/new",
        description:
          "Свежие выгрузки Telegram (pending) по правилам полной карточки",
      },
      {
        id: "imports-facebook",
        label: "Facebook",
        href: "/admin/imports/facebook",
        comingSoon: true,
        description: "История источников Facebook",
      },
      {
        id: "imports-directories",
        label: "Directories",
        href: "/admin/imports/directories",
        legacyHref: "/admin/directories",
        description: "История справочников / Yellow Pages",
      },
      {
        id: "imports-csv",
        label: "CSV",
        href: "/admin/imports/csv",
        comingSoon: true,
        description: "История CSV / one-off импортов",
      },
    ],
  },
  {
    id: "community",
    label: "Community",
    href: "/admin/community",
    children: [
      {
        id: "community-reviews",
        label: "Reviews",
        href: "/admin/community/reviews",
        legacyHref: "/admin/reviews",
        description: "Модерация отзывов",
      },
      {
        id: "community-recommendations",
        label: "Recommendations",
        href: "/admin/community/recommendations",
        legacyHref: "/admin/recommendations",
        description: "Рекомендации из комментариев",
      },
      {
        id: "community-reports",
        label: "Reports",
        href: "/admin/community/reports",
        comingSoon: true,
        description: "Жалобы и репорты",
      },
    ],
  },
  {
    id: "users",
    label: "Users",
    href: "/admin/users",
    children: [
      {
        id: "users-all",
        label: "Users",
        href: "/admin/users",
        description: "Все пользователи и роли",
      },
      {
        id: "users-admins",
        label: "Admins",
        href: "/admin/users/admins",
        comingSoon: true,
        description: "Список администраторов",
      },
      {
        id: "users-roles",
        label: "Roles",
        href: "/admin/users/roles",
        comingSoon: true,
        description: "Роли и права",
      },
    ],
  },
  {
    id: "analytics",
    label: "Analytics",
    href: "/admin/analytics",
  },
  {
    id: "system",
    label: "System",
    href: "/admin/system",
    children: [
      {
        id: "system-taxonomy",
        label: "Taxonomy",
        href: "/admin/system/taxonomy",
        legacyHref: "/admin/master-data",
        description: "Категории, языки, география",
      },
      {
        id: "system-health",
        label: "Health",
        href: "/admin/system/health",
        description: "Кэш агрегатов и latency каталога",
      },
      {
        id: "system-jobs",
        label: "Jobs",
        href: "/admin/system/jobs",
        comingSoon: true,
        description: "Фоновые job-ы",
      },
      {
        id: "system-tasks",
        label: "Background Tasks",
        href: "/admin/system/tasks",
        comingSoon: true,
        description: "Очереди задач",
      },
      {
        id: "system-logs",
        label: "Logs",
        href: "/admin/system/logs",
        comingSoon: true,
        description: "Логи админ-операций",
      },
      {
        id: "system-diagnostics",
        label: "Diagnostics",
        href: "/admin/system/diagnostics",
        comingSoon: true,
        description: "Диагностика платформы",
      },
      {
        id: "system-error-reports",
        label: "Error Reports",
        href: "/admin/system/error-reports",
        description: "Сообщения об ошибках с сайта",
      },
    ],
  },
];

/**
 * Legacy URL → new IA home (documentation + redirects from new → legacy).
 * Old URLs keep working unchanged.
 */
export const ADMIN_LEGACY_MAPPING: Array<{
  legacy: string;
  ia: string;
  note: string;
}> = [
  {
    legacy: "/admin",
    ia: "/admin",
    note: "Dashboard",
  },
  {
    legacy: "/admin/import-review",
    ia: "/admin/review/inbox",
    note: "Import Review → Review Center / Inbox",
  },
  {
    legacy: "/admin/import-review/[id]",
    ia: "/admin/review/inbox (detail stays on legacy URL)",
    note: "Detail workspace unchanged in Phase 1",
  },
  {
    legacy: "/admin/claims",
    ia: "/admin/review/inbox",
    note: "Claims remain at legacy URL; Inbox View later",
  },
  {
    legacy: "/admin/events",
    ia: "/admin/review/inbox",
    note: "Events verification → Review (Catalog Events coming soon)",
  },
  {
    legacy: "/admin/businesses",
    ia: "/admin/catalog/businesses",
    note: "Businesses → Catalog / Businesses",
  },
  {
    legacy: "/admin/listings",
    ia: "/admin/catalog/marketplace",
    note: "Listings → Catalog / Marketplace",
  },
  {
    legacy: "/admin/telegram-groups",
    ia: "/admin/imports/telegram",
    note: "Telegram Groups → Imports / Telegram",
  },
  {
    legacy: "/admin/directories",
    ia: "/admin/imports/directories",
    note: "Directories / Yellow Pages → Imports / Directories",
  },
  {
    legacy: "/admin/yellow-pages",
    ia: "/admin/imports/directories",
    note: "Legacy alias → directories → Imports",
  },
  {
    legacy: "/admin/recommendations",
    ia: "/admin/community/recommendations",
    note: "Recommendations → Community",
  },
  {
    legacy: "/admin/reviews",
    ia: "/admin/community/reviews",
    note: "Reviews → Community",
  },
  {
    legacy: "/admin/users",
    ia: "/admin/users",
    note: "Users",
  },
  {
    legacy: "/admin/analytics",
    ia: "/admin/analytics",
    note: "Analytics",
  },
  {
    legacy: "/admin/master-data",
    ia: "/admin/system/taxonomy",
    note: "Master Data → System / Taxonomy",
  },
];

/** Paths that should highlight a nav item (prefix match) */
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
  if (pathname === href) return true;
  if (href !== "/admin" && pathname.startsWith(href + "/")) return true;
  // Legacy pages highlight IA targets
  if (href === "/admin/review/inbox" && pathname.startsWith("/admin/import-review")) {
    return true;
  }
  if (
    href === "/admin/review/inbox" &&
    pathname.startsWith("/admin/review/") &&
    pathname !== "/admin/review/views"
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
    href === "/admin/imports/telegram" &&
    pathname.startsWith("/admin/telegram-groups")
  ) {
    return true;
  }
  if (
    href === "/admin/imports/directories" &&
    (pathname.startsWith("/admin/directories") ||
      pathname.startsWith("/admin/yellow-pages"))
  ) {
    return true;
  }
  if (href === "/admin/community/reviews" && pathname.startsWith("/admin/reviews")) {
    return true;
  }
  if (
    href === "/admin/community/recommendations" &&
    pathname.startsWith("/admin/recommendations")
  ) {
    return true;
  }
  if (href === "/admin/system/taxonomy" && pathname.startsWith("/admin/master-data")) {
    return true;
  }
  if (href === "/admin/users" && pathname === "/admin/users") {
    return true;
  }
  if (href === "/admin/analytics" && pathname.startsWith("/admin/analytics")) {
    return true;
  }
  return false;
}
