import type {
  InboxEntityType,
  InboxReviewType,
  InboxSourceKey,
} from "@/lib/admin/inbox/types";

export const INBOX_ENTITY_LABELS: Record<InboxEntityType, string> = {
  business: "Business",
  professional: "Professional",
  marketplace: "Marketplace",
  job: "Job",
  event: "Event",
  service: "Service",
  organization: "Organization",
  other: "Other",
  unknown: "Unknown",
};

export const INBOX_SOURCE_LABELS: Record<InboxSourceKey, string> = {
  telegram: "Telegram",
  facebook: "Facebook",
  directories: "Directories",
  loveoverse: "Loveoverse",
  eventbrite: "Eventbrite",
  professional_cleanup: "Professional Cleanup",
  claims: "Claims",
  recommendations: "Recommendations",
  import: "Import",
  other: "Other",
};

export const INBOX_REVIEW_TYPE_LABELS: Record<InboxReviewType, string> = {
  import_review: "Import Review",
  ownership_claim: "Ownership Claim",
  event_verification: "Events — ждут выкладки",
  recommendation: "Recommendation",
};

export const INBOX_ENTITY_OPTIONS: Array<InboxEntityType | "all"> = [
  "all",
  "business",
  "professional",
  "marketplace",
  "job",
  "event",
  "service",
  "organization",
  "other",
  "unknown",
];

export const INBOX_SOURCE_OPTIONS: Array<InboxSourceKey | "all"> = [
  "all",
  "telegram",
  "facebook",
  "directories",
  "loveoverse",
  "eventbrite",
  "professional_cleanup",
  "claims",
  "recommendations",
  "import",
  "other",
];

export const INBOX_REVIEW_TYPE_OPTIONS: Array<InboxReviewType | "all"> = [
  "all",
  "import_review",
  "ownership_claim",
  "event_verification",
  "recommendation",
];

export const INBOX_STATUS_OPTIONS = [
  "all",
  "pending",
  "suspected_duplicate",
  "in_review",
  "needs_more_info",
  "ready_to_publish",
  "quarantine",
] as const;
