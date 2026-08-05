/**
 * Deep-links from Imports (provenance) → Review Center Inbox.
 */

import type { InboxSourceKey, InboxViewId } from "@/lib/admin/inbox/types";

export type ImportsInboxLinkOpts = {
  view?: InboxViewId;
  source?: InboxSourceKey;
  sourceRef?: string;
  reviewType?: "recommendation" | "import_review" | "event_verification";
  status?: string;
};

export function importsInboxHref(opts: ImportsInboxLinkOpts = {}): string {
  const q = new URLSearchParams();
  if (opts.view && opts.view !== "all") q.set("view", opts.view);
  if (opts.source) q.set("source", opts.source);
  if (opts.sourceRef) q.set("sourceRef", opts.sourceRef);
  if (opts.reviewType) q.set("reviewType", opts.reviewType);
  if (opts.status && opts.status !== "all") q.set("status", opts.status);
  const qs = q.toString();
  return qs ? `/admin/review/inbox?${qs}` : "/admin/review/inbox";
}

export function telegramSourceInboxHref(sourceId: string): string {
  return importsInboxHref({
    view: "telegram",
    source: "telegram",
    sourceRef: sourceId,
  });
}

export function directorySourceInboxHref(sourceId: string): string {
  return importsInboxHref({
    view: "directories",
    source: "directories",
    sourceRef: sourceId,
  });
}
