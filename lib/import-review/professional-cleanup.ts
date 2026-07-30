/** Helpers for Professional Cleanup → Admin Import Review handoff. */

export const PROFESSIONAL_CLEANUP_SOURCE = "professional_cleanup_v1";

export type ProfessionalCleanupProblem =
  | "ambiguous_classification"
  | "insufficient_contacts"
  | "possible_duplicate"
  | "multiple_possible_categories"
  | "low_confidence"
  | "missing_required_fields";

export type ProfessionalCleanupPayload = {
  origin: "professional_cleanup_phase2";
  existing_professional_id: string;
  existing_professional_slug?: string;
  cleanup_reason?: string;
  suggested_entity_type?: string;
  suggested_target_collection?: string;
  confidence?: number;
  problems?: string[];
  analysis?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
};

export function parseProfessionalCleanupPayload(
  raw: unknown,
): ProfessionalCleanupPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.origin !== "professional_cleanup_phase2") return null;
  const id = obj.existing_professional_id;
  if (typeof id !== "string" || !id.trim()) return null;
  return {
    origin: "professional_cleanup_phase2",
    existing_professional_id: id,
    existing_professional_slug:
      typeof obj.existing_professional_slug === "string"
        ? obj.existing_professional_slug
        : undefined,
    cleanup_reason:
      typeof obj.cleanup_reason === "string" ? obj.cleanup_reason : undefined,
    suggested_entity_type:
      typeof obj.suggested_entity_type === "string"
        ? obj.suggested_entity_type
        : undefined,
    suggested_target_collection:
      typeof obj.suggested_target_collection === "string"
        ? obj.suggested_target_collection
        : undefined,
    confidence:
      typeof obj.confidence === "number" ? obj.confidence : undefined,
    problems: Array.isArray(obj.problems)
      ? obj.problems.filter((p): p is string => typeof p === "string")
      : undefined,
    analysis:
      obj.analysis && typeof obj.analysis === "object"
        ? (obj.analysis as Record<string, unknown>)
        : undefined,
    snapshot:
      obj.snapshot && typeof obj.snapshot === "object"
        ? (obj.snapshot as Record<string, unknown>)
        : undefined,
  };
}

export function isProfessionalCleanupSource(source: string | null | undefined) {
  return (source || "") === PROFESSIONAL_CLEANUP_SOURCE;
}

export const CLEANUP_PROBLEM_LABELS: Record<string, string> = {
  ambiguous_classification: "ambiguous classification",
  insufficient_contacts: "insufficient contacts",
  possible_duplicate: "possible duplicate",
  multiple_possible_categories: "multiple possible categories",
  low_confidence: "low confidence",
  missing_required_fields: "missing required fields",
};
