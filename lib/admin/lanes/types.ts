/**
 * Admin order lanes — permanent classify contract for queue → catalog.
 * Shared by Inbox UI, ingest hooks, and backlog dry-run/apply.
 */

export const ADMIN_LANE_IDS = [
  "attach",
  "route",
  "ready",
  "seeking",
  "quarantine",
  "review",
] as const;

export type AdminLaneId = (typeof ADMIN_LANE_IDS)[number];

export const ADMIN_LANE_LABELS: Record<AdminLaneId, string> = {
  attach: "Прикрепить",
  route: "Разложить",
  ready: "Готово → OK",
  seeking: "Я ищу",
  quarantine: "Помойка",
  review: "Разбор",
};

export const ADMIN_LANE_HINTS: Record<AdminLaneId, string> = {
  attach: "Рекомендация или дубль к уже живой карточке",
  route: "Есть раздел, ещё не готова к публикации",
  ready: "Можно выкладывать одним кликом",
  seeking: "Спрос — готовим, категорию не создаём",
  quarantine: "Карантин: вернуть или уничтожить",
  review: "Нужен разбор человеком или LLM",
};

export type LaneClassifyInput = {
  kind: "import_review" | "recommendation" | "event_recommendation";
  status: string | null | undefined;
  reviewNotes?: string | null;
  entityType?: string | null;
  targetCollection?: string | null;
  title?: string | null;
  businessName?: string | null;
  personName?: string | null;
  displayName?: string | null;
  description?: string | null;
  sourceText?: string | null;
  phone?: string | null | string[];
  email?: string | null | string[];
  website?: string | null | string[];
  instagram?: string | null | string[];
  telegram?: string | null;
  city?: string | null;
  addressLine?: string | null;
  /** Taxonomy / category id or label when known */
  category?: string | null;
  /** 0–100 checklist or weighted completeness */
  completenessPercent?: number | null;
  /** Recommendation already linked as suspected duplicate of live entity */
  suspectedDuplicate?: boolean;
  /** Recommendation has duplicate_of_entity_id set */
  hasDuplicateTarget?: boolean;
  /** Third-party mention without self-offer (attach-only) */
  thirdPartyOnly?: boolean;
  eventStartsAt?: string | null;
};

export type LaneClassifyResult = {
  lane: AdminLaneId;
  reason: string;
  /** Suggested target_collection when routing */
  suggestedCollection?: string | null;
  suggestedEntityType?: string | null;
};
