"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";

type EditModeBannerProps = {
  businessSlug: string;
  activeTab?: string | null;
};

export function EditModeBanner({ businessSlug, activeTab }: EditModeBannerProps) {
  const exitHref = activeTab
    ? `/business/${businessSlug}?tab=${encodeURIComponent(activeTab)}`
    : `/business/${businessSlug}`;

  return (
    <div className="sticky top-0 z-30 -mx-4 border-b border-brand-blue/20 bg-brand-blue/10 px-4 py-2.5 sm:mx-0 sm:rounded-2xl sm:border">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-sm font-medium text-brand-blue-deep">
          <Pencil aria-hidden="true" className="size-3.5" />
          Режим редактирования — нажмите карандаш у блока, чтобы изменить
        </p>
        <Link
          className="rounded-lg border border-brand-blue/30 bg-white px-3 py-1.5 text-xs font-medium text-brand-blue-deep hover:bg-brand-blue/5"
          href={exitHref}
          scroll={false}
        >
          Готово
        </Link>
      </div>
    </div>
  );
}
