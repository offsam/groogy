"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  getLegacyMigrationEntry,
  LEGACY_BANNER_SESSION_PREFIX,
} from "@/lib/admin/legacy-migration";

type Props = {
  /** Key from ADMIN_LEGACY_MIGRATION */
  migrationId: string;
};

export function LegacyMigrationBanner({ migrationId }: Props) {
  const entry = getLegacyMigrationEntry(migrationId);
  const storageKey = `${LEGACY_BANNER_SESSION_PREFIX}${migrationId}`;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(storageKey) === "1") {
        setVisible(false);
        return;
      }
    } catch {
      // ignore private mode / blocked storage
    }
    setVisible(true);
  }, [storageKey]);

  if (!entry || !visible) return null;

  function dismiss() {
    try {
      sessionStorage.setItem(storageKey, "1");
    } catch {
      // ignore
    }
    setVisible(false);
  }

  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 space-y-1">
        <p className="font-medium">
          This page is part of the legacy admin interface.
        </p>
        <p className="text-xs text-amber-900/80">
          Preferred path:{" "}
          <span className="font-medium">{entry.newLabel}</span>
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Link
          href={entry.newHref}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
        >
          {entry.ctaLabel}
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-950 hover:bg-amber-100"
          aria-label="Dismiss banner for this session"
        >
          <X className="size-3.5" aria-hidden />
          Dismiss
        </button>
      </div>
    </div>
  );
}
