"use client";

import Link from "next/link";
import { tabHref, type ProfileTab } from "@/lib/business/profile-tabs";
import { cn } from "@/lib/utils";

type BusinessProfileTabsProps = {
  tabs: ProfileTab[];
  activeTab: string;
  businessSlug: string;
  editMode?: boolean;
};

export function BusinessProfileTabs({
  tabs,
  activeTab,
  businessSlug,
  editMode = false,
}: BusinessProfileTabsProps) {
  if (tabs.length === 0) return null;

  return (
    <nav
      aria-label="Разделы профиля"
      className="sticky top-[3.25rem] z-30 -mx-4 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-2"
    >
      <div className="flex gap-0.5 overflow-x-auto py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <Link
              key={tab.id}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
              href={tabHref(businessSlug, tab.id, { edit: editMode })}
              scroll={false}
              style={isActive ? { color: "#ffffff" } : undefined}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
