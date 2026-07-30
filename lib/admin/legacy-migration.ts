/**
 * Soft migration: legacy Admin URLs → Admin Panel IA V2 targets.
 * Source of Truth: docs/architecture/ADMIN_PANEL_IA_V2.md
 */

export type LegacyMigrationStatus =
  | "Fully Migrated"
  | "Partial"
  | "Legacy Only"
  | "Can be removed later";

export type LegacyMigrationEntry = {
  id: string;
  legacyUrl: string;
  legacyLabel: string;
  newHref: string;
  newLabel: string;
  /** CTA button label on the banner */
  ctaLabel: string;
  status: LegacyMigrationStatus;
  notes: string;
};

/** Canonical mapping for banners + audit. */
export const ADMIN_LEGACY_MIGRATION: LegacyMigrationEntry[] = [
  {
    id: "import-review",
    legacyUrl: "/admin/import-review",
    legacyLabel: "Import Review",
    newHref: "/admin/review/inbox",
    newLabel: "Review Center / Inbox",
    ctaLabel: "Open in New Review Center",
    status: "Partial",
    notes:
      "Inbox aggregates this queue; Workspace + /edit embed ImportReviewDetailPanel — legacy detail is compatibility only.",
  },
  {
    id: "recommendations",
    legacyUrl: "/admin/recommendations",
    legacyLabel: "Recommendations",
    newHref: "/admin/review/inbox?view=recommendations",
    newLabel: "Review Center / Recommendations View",
    ctaLabel: "Open in New Review Center",
    status: "Partial",
    notes:
      "Approve/reject + edit fields live in Workspace; legacy list is compatibility.",
  },
  {
    id: "claims",
    legacyUrl: "/admin/claims",
    legacyLabel: "Ownership Claims",
    newHref: "/admin/review/inbox?view=claims",
    newLabel: "Review Center / Claims View",
    ctaLabel: "Open in New Review Center",
    status: "Partial",
    notes: "Workspace opens claims; inline approve still on legacy panel.",
  },
  {
    id: "events-verification",
    legacyUrl: "/admin/events",
    legacyLabel: "Events Verification",
    newHref: "/admin/review/inbox?view=events",
    newLabel: "Review Center / Events — ждут выкладки",
    ctaLabel: "Open in New Review Center",
    status: "Fully Migrated",
    notes:
      "Redirects to Inbox Events view; Structure / Translate / Approve in Workspace.",
  },
  {
    id: "telegram-groups",
    legacyUrl: "/admin/telegram-groups",
    legacyLabel: "Telegram Groups",
    newHref: "/admin/imports/telegram",
    newLabel: "Imports / Telegram",
    ctaLabel: "Open in New Imports",
    status: "Partial",
    notes:
      "Page already history-oriented (Phase 4); IA path is /admin/imports/telegram → same UI.",
  },
  {
    id: "directories",
    legacyUrl: "/admin/directories",
    legacyLabel: "Directories",
    newHref: "/admin/imports/directories",
    newLabel: "Imports / Directories",
    ctaLabel: "Open in New Imports",
    status: "Partial",
    notes:
      "Page already history-oriented (Phase 4); IA path is /admin/imports/directories → same UI.",
  },
];

export function getLegacyMigrationEntry(
  id: string,
): LegacyMigrationEntry | undefined {
  return ADMIN_LEGACY_MIGRATION.find((e) => e.id === id);
}

export const LEGACY_BANNER_SESSION_PREFIX = "krugi-admin-legacy-banner:";
