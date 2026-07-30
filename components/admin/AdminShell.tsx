"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Menu, Shield, X } from "lucide-react";
import {
  ADMIN_NAV,
  matchAdminNavHref,
  type AdminNavSection,
} from "@/lib/admin/nav";
import { cn } from "@/lib/utils";

function sectionOpenByDefault(section: AdminNavSection, pathname: string): boolean {
  if (section.href && pathname.startsWith(section.href)) return true;
  return (section.children ?? []).some(
    (c) =>
      pathname === c.href ||
      pathname.startsWith(c.href + "/") ||
      (c.legacyHref
        ? pathname.startsWith(c.legacyHref.split("?")[0])
        : false) ||
      matchAdminNavHref(pathname, "", c.href),
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/admin";
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const resolvedOpen = useMemo(() => {
    const next: Record<string, boolean> = { ...openSections };
    for (const section of ADMIN_NAV) {
      if (next[section.id] === undefined) {
        next[section.id] = sectionOpenByDefault(section, pathname);
      }
    }
    return next;
  }, [openSections, pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, search]);

  useEffect(() => {
    if (!mobileOpen) return;
    // Phone overlay only — avoid locking tablet/desktop scroll
    const mq = window.matchMedia("(max-width: 639px)");
    if (!mq.matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  function toggleSection(id: string) {
    setOpenSections((prev) => ({
      ...prev,
      [id]: !(resolvedOpen[id] ?? false),
    }));
  }

  const nav = (
    <nav className="space-y-1 text-sm" aria-label="Admin">
      {ADMIN_NAV.map((section) => {
        const hasChildren = (section.children?.length ?? 0) > 0;
        const open = resolvedOpen[section.id] ?? false;
        const sectionActive =
          section.href != null &&
          matchAdminNavHref(pathname, search, section.href) &&
          !hasChildren;

        return (
          <div key={section.id} className="pb-1">
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <span>{section.label}</span>
                <ChevronDown
                  className={`size-3.5 transition ${open ? "rotate-0" : "-rotate-90"}`}
                />
              </button>
            ) : section.href ? (
              <Link
                href={section.href}
                onClick={() => setMobileOpen(false)}
                className={`block rounded-lg px-2.5 py-2 text-sm font-medium ${
                  sectionActive
                    ? "bg-slate-900 text-white"
                    : "text-slate-800 hover:bg-slate-100"
                }`}
              >
                {section.label}
              </Link>
            ) : (
              <div className="px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {section.label}
              </div>
            )}

            {hasChildren && open ? (
              <ul className="mt-0.5 ml-2 space-y-0.5 border-l border-slate-200 pl-2">
                {section.children!.map((item) => {
                  const active = matchAdminNavHref(pathname, search, item.href);
                  return (
                    <li key={item.id}>
                      <Link
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 ${
                          active
                            ? "bg-brand-blue/10 font-medium text-brand-blue-deep"
                            : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <span>{item.label}</span>
                        {item.comingSoon ? (
                          <span className="shrink-0 rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-orange-800">
                            Soon
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="admin-shell min-h-[70vh] min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3 max-sm:mb-2 lg:hidden">
        <p className="inline-flex items-center gap-2 text-sm font-medium text-brand-blue-deep">
          <Shield className="size-4" />
          Admin
        </p>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          Меню
        </button>
      </div>

      {/* Phone backdrop for nav overlay */}
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Закрыть меню"
          className="fixed inset-0 z-[80] bg-slate-950/40 max-sm:block sm:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <div className="flex flex-col gap-4 sm:gap-6 lg:flex-row lg:items-start">
        <aside
          className={cn(
            "w-full shrink-0 rounded-2xl border border-slate-200 bg-white p-3 lg:sticky lg:top-20 lg:block lg:w-60",
            mobileOpen ? "block" : "hidden lg:block",
            // Phone: floating sheet so content stays scrollable underneath
            "max-sm:fixed max-sm:inset-x-3 max-sm:top-[4.5rem] max-sm:z-[90] max-sm:max-h-[min(75dvh,32rem)] max-sm:overflow-y-auto max-sm:shadow-2xl",
          )}
        >
          <div className="mb-3 hidden items-center gap-2 px-2.5 lg:flex">
            <Shield className="size-4 text-brand-blue-deep" />
            <span className="text-sm font-semibold text-slate-900">
              Admin Panel
            </span>
          </div>
          <p className="mb-3 hidden px-2.5 text-[11px] leading-snug text-slate-500 lg:block">
            IA V2 shell · Phase 1 — навигация без переноса логики
          </p>
          {nav}
        </aside>

        <div className="min-w-0 flex-1 overflow-x-hidden">{children}</div>
      </div>
    </div>
  );
}
