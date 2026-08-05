/**
 * Deterministic lane classifier — $0, no LLM.
 * Maximize harvest into catalog sections; quarantine only obvious junk.
 */

import {
  routeCard,
  ENTITY_TO_COLLECTION,
  type RouteResult,
} from "@/lib/import-review/entity-routing";
import {
  TAG_QUARANTINE,
  TAG_SEEKING,
  notesHasTag,
} from "@/lib/import-review/review-tags";
import { isEventPast } from "@/lib/events/timing";
import type {
  AdminLaneId,
  LaneClassifyInput,
  LaneClassifyResult,
} from "@/lib/admin/lanes/types";

/** Demand / «я ищу» — not a self-offer. Public category not created. */
const SEEKING_RE =
  /(?:^|[\n.!?…])\s*(?:ищу|ищем|нужен|нужна|нужно|посоветуйте|порекомендуйте|кто\s+знает|looking\s+for)(?:\s|$|[.,!?…])/iu;
const SEEKING_JOB_RE =
  /(?:ищу|ищем)\s+(?:работ|подработ|позици)|looking\s+for\s+(?:a\s+)?(?:job|position)|резюме(?:\s|$)|resume\b/iu;
const SELF_OFFER_RE =
  /(?:предлагаю|оказываю|записывайтесь|прайс|\$\s*\d+|мой\s+телеграм|пишите\s+в\s+(?:лс|директ)|открыта\s+запись)/iu;

function asList(value: string | string[] | null | undefined): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v || "").trim()).filter(Boolean);
  }
  const t = String(value).trim();
  return t ? [t] : [];
}

function blobOf(input: LaneClassifyInput): string {
  return [
    input.title,
    input.businessName,
    input.personName,
    input.displayName,
    input.description,
    input.sourceText,
  ]
    .filter(Boolean)
    .join("\n");
}

export function hasAnyContact(input: LaneClassifyInput): boolean {
  return (
    asList(input.phone).length > 0 ||
    asList(input.email).length > 0 ||
    asList(input.website).length > 0 ||
    asList(input.instagram).length > 0 ||
    Boolean(input.telegram?.trim())
  );
}

export function isSeekingDemand(input: LaneClassifyInput): boolean {
  if (notesHasTag(input.reviewNotes, TAG_SEEKING)) return true;
  const blob = blobOf(input);
  if (!blob.trim()) return false;
  // Self-offer with a phone wins over «ищу клиентов».
  if (SELF_OFFER_RE.test(blob) && hasAnyContact(input)) return false;
  if (SEEKING_JOB_RE.test(blob)) return true;
  if (!SEEKING_RE.test(blob)) return false;
  // Demand without seller contact → seeking hold.
  if (!hasAnyContact(input)) return true;
  // «Ищу мастера» with only requester contacts still seeking.
  if (!SELF_OFFER_RE.test(blob)) return true;
  return false;
}

function isObviousJunk(input: LaneClassifyInput): boolean {
  const blob = blobOf(input).replace(/\s+/g, " ").trim();
  if (blob.length < 8 && !hasAnyContact(input)) return true;
  if (
    input.kind !== "import_review" &&
    !hasAnyContact(input) &&
    !(input.displayName || input.title || "").trim()
  ) {
    return true;
  }
  // Past event with no brand/contact — no recoverable catalog value.
  if (
    (input.entityType === "event" || input.kind === "event_recommendation") &&
    input.eventStartsAt &&
    isEventPast(input.eventStartsAt) &&
    !hasAnyContact(input) &&
    !(input.businessName || "").trim()
  ) {
    return true;
  }
  return false;
}

function routeHint(input: LaneClassifyInput): RouteResult | null {
  const blob = blobOf(input);
  if (!blob.trim() && !input.entityType) return null;
  try {
    return routeCard({
      text: blob,
      businessName: input.businessName,
      personName: input.personName,
      category: null,
      classification: null,
      entityTypeHint: input.entityType,
      addressLine: input.addressLine,
      hasContact: hasAnyContact(input),
    });
  } catch {
    return null;
  }
}

const READY_THRESHOLD = 70;

/**
 * Classify one queue item into an admin lane.
 * Does not write DB — callers apply tags/status via lane actions.
 */
export function classifyLane(input: LaneClassifyInput): LaneClassifyResult {
  const status = (input.status || "").trim().toLowerCase();
  const notes = input.reviewNotes || "";

  if (
    status === "quarantine" ||
    notesHasTag(notes, TAG_QUARANTINE)
  ) {
    return { lane: "quarantine", reason: "already_quarantine" };
  }

  // Settled elsewhere — treat as review so UI can hide via status filters.
  if (
    status === "approved" ||
    status === "rejected" ||
    status === "duplicate" ||
    status === "merged"
  ) {
    return { lane: "review", reason: `settled:${status}` };
  }

  if (
    input.suspectedDuplicate ||
    input.hasDuplicateTarget ||
    status === "suspected_duplicate" ||
    input.thirdPartyOnly
  ) {
    return {
      lane: "attach",
      reason: input.thirdPartyOnly
        ? "third_party_recommendation"
        : "suspected_or_linked_duplicate",
    };
  }

  if (isSeekingDemand(input)) {
    return { lane: "seeking", reason: "demand_seeking" };
  }

  if (isObviousJunk(input)) {
    return { lane: "quarantine", reason: "obvious_junk" };
  }

  if (status === "ready_to_publish") {
    return {
      lane: "ready",
      reason: "status_ready_to_publish",
      suggestedCollection: input.targetCollection,
      suggestedEntityType: input.entityType,
    };
  }

  const completeness = input.completenessPercent;
  const typed = Boolean(input.entityType && input.targetCollection);
  const hasCategory = Boolean((input.category || "").trim());
  // Ready only when typed + contact + real score — AND not an empty shell
  // (no narrative, no category). Contact alone must not look “70% ready”.
  const hasNarrative = Boolean(
    (input.description || "").replace(/\s+/g, " ").trim().length >= 40,
  );
  if (
    typed &&
    hasAnyContact(input) &&
    typeof completeness === "number" &&
    completeness >= READY_THRESHOLD &&
    (hasNarrative || hasCategory)
  ) {
    return {
      lane: "ready",
      reason: "completeness_ready",
      suggestedCollection: input.targetCollection,
      suggestedEntityType: input.entityType,
    };
  }

  if (typed) {
    return {
      lane: "route",
      reason: "typed_not_ready",
      suggestedCollection: input.targetCollection,
      suggestedEntityType: input.entityType,
    };
  }

  const routed = routeHint(input);
  if (routed?.entityType && routed.targetCollection && !routed.needsManualType) {
    return {
      lane: "route",
      reason: routed.reason || "entity_routing",
      suggestedCollection: routed.targetCollection,
      suggestedEntityType: routed.entityType,
    };
  }

  if (routed?.entityType && ENTITY_TO_COLLECTION[routed.entityType]) {
    return {
      lane: "route",
      reason: routed.reason || "entity_routing_partial",
      suggestedCollection:
        routed.targetCollection || ENTITY_TO_COLLECTION[routed.entityType],
      suggestedEntityType: routed.entityType,
    };
  }

  return { lane: "review", reason: "needs_human" };
}

export function laneMatches(
  result: LaneClassifyResult,
  lane: AdminLaneId | "all" | null | undefined,
): boolean {
  if (!lane || lane === "all") return true;
  return result.lane === lane;
}
