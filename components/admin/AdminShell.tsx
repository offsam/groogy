"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Crumb = { href: string; label: string };

/**
 * Parent crumbs for the current admin path — always a way back,
 * without jumping to a random sibling section.
 */
function adminCrumbs(pathname: string): Crumb[] {
  if (pathname === "/admin") return [];

  // Workspace card: list → sources hub
  if (
    pathname.startsWith("/admin/review/") &&
    !pathname.startsWith("/admin/review/inbox") &&
    !pathname.startsWith("/admin/review/views") &&
    !pathname.startsWith("/admin/review/wrong-section")
  ) {
    return [
      { href: "/admin/review/inbox", label: "← К списку" },
      { href: "/admin/queue", label: "На обработку" },
    ];
  }

  if (pathname.startsWith("/admin/review/inbox")) {
    return [{ href: "/admin/queue", label: "← На обработку" }];
  }

  if (pathname.startsWith("/admin/queue")) {
    return [{ href: "/admin", label: "← Админка" }];
  }

  if (
    pathname.startsWith("/admin/sources/") &&
    pathname !== "/admin/sources"
  ) {
    return [
      { href: "/admin/sources", label: "← Источники" },
      { href: "/admin", label: "Админка" },
    ];
  }

  if (pathname.startsWith("/admin/sources")) {
    return [{ href: "/admin", label: "← Админка" }];
  }

  if (pathname.startsWith("/admin/resources")) {
    return [{ href: "/admin", label: "← Админка" }];
  }

  if (
    pathname.startsWith("/admin/catalog/") &&
    pathname !== "/admin/catalog"
  ) {
    return [
      { href: "/admin/catalog", label: "← Каталог" },
      { href: "/admin", label: "Админка" },
    ];
  }

  if (pathname.startsWith("/admin/imports/telegram")) {
    if (pathname !== "/admin/imports/telegram") {
      return [
        { href: "/admin/queue", label: "← На обработку" },
        { href: "/admin", label: "Админка" },
      ];
    }
    return [{ href: "/admin/queue", label: "← На обработку" }];
  }

  if (pathname.startsWith("/admin/imports/directories")) {
    if (pathname !== "/admin/imports/directories") {
      return [
        { href: "/admin/queue", label: "← На обработку" },
        { href: "/admin", label: "Админка" },
      ];
    }
    return [{ href: "/admin/queue", label: "← На обработку" }];
  }

  if (pathname.startsWith("/admin/system/")) {
    return [{ href: "/admin", label: "← Админка" }];
  }

  if (pathname.startsWith("/admin/community/")) {
    return [{ href: "/admin", label: "← Админка" }];
  }

  // Default: always back to home
  return [{ href: "/admin", label: "← Админка" }];
}

/**
 * No left sidebar. Home = admin sections. Queue hub = sources.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/admin";
  const crumbs = adminCrumbs(pathname);

  return (
    <div className="admin-shell min-h-[70vh] min-w-0">
      {crumbs.length > 0 ? (
        <nav
          className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
          aria-label="Навигация админки"
        >
          {crumbs.map((crumb) => (
            <Link
              key={crumb.href + crumb.label}
              href={crumb.href}
              className={
                crumb.label.startsWith("←")
                  ? "font-medium text-brand-blue hover:underline"
                  : "text-slate-600 hover:underline"
              }
            >
              {crumb.label}
            </Link>
          ))}
        </nav>
      ) : null}
      <div className="min-w-0 overflow-x-hidden">{children}</div>
    </div>
  );
}
