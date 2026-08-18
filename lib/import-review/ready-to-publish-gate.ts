/**
 * Quality gate for import_review_items.review_status = ready_to_publish.
 * Shared by Inbox, admin promote, and ingest (TS). Python mirror:
 * scripts/import-review/ready_to_publish_gate.py
 */

import { isJunkImportTitle } from "@/lib/import-review/display-name";

export const READY_DUPLICATE_BLOCKLIST = [
  "recurring_ad",
  "exact_duplicate",
  "likely_duplicate",
] as const;

export type ReadyToPublishFailReason =
  | "no_phone_or_city"
  | "unusable_title"
  | "duplicate";

export type ReadyToPublishInput = {
  title?: string | null;
  business_name?: string | null;
  person_name?: string | null;
  description?: string | null;
  source_text?: string | null;
  phone?: string | string[] | null;
  city?: string | null;
  duplicate_status?: string | null;
};

const HANDLE_TOKEN_RE = /\b@?[a-z][a-z0-9]*(?:_[a-z0-9]+){1,}\b/i;
const BARE_USERNAME_RE = /^@?[A-Za-z][A-Za-z0-9._]{2,31}$/;
const LETTER_RE = /\p{L}/gu;

function letterCount(value: string): number {
  return (value.match(LETTER_RE) || []).length;
}

function firstFilled(values: Array<string | null | undefined>): string {
  for (const raw of values) {
    const t = (raw || "").replace(/\s+/g, " ").trim();
    if (t) return t;
  }
  return "";
}

function hasNonEmpty(value: string | string[] | null | undefined): boolean {
  if (Array.isArray(value)) {
    return value.some((x) => String(x || "").trim().length > 0);
  }
  return Boolean(String(value || "").trim());
}

/** Telegram handle, one character, empty, or the whole post pasted as the name. */
export function isUnusableReadyTitle(
  raw: string | null | undefined,
  extras?: { description?: string | null; sourceText?: string | null },
): boolean {
  const t = (raw || "").replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (t.length <= 1) return true;
  if (letterCount(t) < 3) return true;
  if (isJunkImportTitle(t)) return true;
  if (BARE_USERNAME_RE.test(t) && /[._]/.test(t)) return true;
  if (HANDLE_TOKEN_RE.test(t) && t.split(" ").length <= 5) return true;
  if (t.length > 90) return true;

  const blob = firstFilled([extras?.description, extras?.sourceText]);
  if (blob && t.length >= 48) {
    const compactTitle = t.slice(0, 80);
    if (blob.startsWith(compactTitle) || blob.includes(compactTitle)) {
      return true;
    }
  }
  return false;
}

export function displayTitleForReadyGate(input: ReadyToPublishInput): string {
  return firstFilled([input.title, input.business_name, input.person_name]);
}

export function qualifiesReadyToPublish(input: ReadyToPublishInput): {
  ok: boolean;
  reason?: ReadyToPublishFailReason;
} {
  const hasPhone = hasNonEmpty(input.phone);
  const hasCity = Boolean((input.city || "").trim());
  if (!hasPhone && !hasCity) {
    return { ok: false, reason: "no_phone_or_city" };
  }

  const dup = (input.duplicate_status || "").trim().toLowerCase();
  if (
    READY_DUPLICATE_BLOCKLIST.includes(
      dup as (typeof READY_DUPLICATE_BLOCKLIST)[number],
    )
  ) {
    return { ok: false, reason: "duplicate" };
  }

  const title = displayTitleForReadyGate(input);
  if (
    isUnusableReadyTitle(title, {
      description: input.description,
      sourceText: input.source_text,
    })
  ) {
    return { ok: false, reason: "unusable_title" };
  }

  return { ok: true };
}

const LOCKED_STATUSES = new Set([
  "approved",
  "rejected",
  "duplicate",
  "quarantine",
]);

/**
 * Apply the ready gate to a requested queue status. Never publishes.
 * `preferReady` is for AI-accepted ingest that would otherwise stay pending.
 */
export function statusAfterReadyGate(
  input: ReadyToPublishInput,
  requested: string | null | undefined,
  opts?: { preferReady?: boolean },
): {
  status: string;
  reason?: ReadyToPublishFailReason;
} {
  const wanted = (requested || "pending").trim() || "pending";
  if (LOCKED_STATUSES.has(wanted)) {
    return { status: wanted };
  }

  const wantsReady = wanted === "ready_to_publish" || Boolean(opts?.preferReady);
  if (!wantsReady) {
    return { status: wanted };
  }

  const result = qualifiesReadyToPublish(input);
  if (result.ok) {
    return { status: "ready_to_publish" };
  }
  if (result.reason === "no_phone_or_city") {
    return { status: "needs_more_info", reason: result.reason };
  }
  return { status: "pending", reason: result.reason };
}
