export type ImportReviewStatus =
  | "pending"
  | "in_review"
  | "approved"
  | "rejected"
  | "duplicate"
  | "needs_more_info"
  | "ready_to_publish"
  | "quarantine";

export type ImportReviewTargetCollection =
  | "businesses"
  | "private_specialists"
  | "services"
  | "marketplace"
  | "jobs"
  | "events"
  | "organizations"
  | "real_estate"
  | "lechu"
  | "transfers";

export type ImportReviewEntityType =
  | "business"
  | "private_specialist"
  | "marketplace_listing"
  | "organization"
  | "event"
  | "job"
  | "real_estate"
  | "lechu_listing"
  | "transfer_listing";

export type ImportReviewSourceMedia = {
  telegram_message_id?: number | null;
  media_type?: string | null;
  original_filename?: string | null;
  width?: number | null;
  height?: number | null;
  telegram_media_reference?: string | null;
  download_status?: "pending" | "downloaded" | "failed" | "skipped" | null;
  storage_path?: string | null;
};

export type ImportReviewItem = {
  id: string;
  source: string;
  source_group: string | null;
  source_chat_id: string | null;
  source_message_ids: number[];
  source_fingerprint: string;
  source_author_id: string | null;
  source_author_username: string | null;
  source_author_display_name: string | null;
  source_posted_at: string | null;
  source_text: string | null;
  source_url: string | null;
  source_media: ImportReviewSourceMedia[];
  ai_decision: string | null;
  ai_confidence: number | null;
  ai_reason: string | null;
  entity_type: ImportReviewEntityType | null;
  target_collection: ImportReviewTargetCollection | null;
  category: string | null;
  subcategory: string | null;
  title: string | null;
  business_name: string | null;
  person_name: string | null;
  description: string | null;
  /** Source-language description; public/admin `description` may be RU. */
  description_original?: string | null;
  source_language?: string | null;
  services: string[];
  payment_methods?: string[];
  /** Extracted акции before publish — same shape as entity_promotions rows. */
  promotions?: import("@/types/promotion").QueuePromotion[];
  /** Extracted новости before publish — same shape as entity_updates rows. */
  updates?: import("@/types/update").QueueUpdate[];
  price: number | null;
  currency: string | null;
  city: string | null;
  state: string | null;
  /** Street / suite from website or post (shared workplace OK). */
  address_line?: string | null;
  postal_code?: string | null;
  /** Census county FIPS — required for publish (USA Location Canon). */
  county_geoid?: string | null;
  location_source?:
    | "zip"
    | "city"
    | "coordinates"
    | "source_group"
    | "manual"
    | null;
  location_confidence?: "exact" | "inferred" | null;
  phone: string[];
  whatsapp: string[];
  telegram_username: string | null;
  telegram_user_id: string | null;
  instagram: string[];
  website: string[];
  email: string[];
  photos_count: number;
  preview_image_url?: string | null;
  duplicate_status: string | null;
  recurring_cluster_id: string | null;
  occurrence_count: number | null;
  first_seen: string | null;
  last_seen: string | null;
  raw_payload: Record<string, unknown>;
  review_status: ImportReviewStatus;
  review_notes: string | null;
  reject_reason: string | null;
  duplicate_of_item_id: string | null;
  duplicate_of_entity_type: string | null;
  duplicate_of_entity_id: string | null;
  published_entity_type: string | null;
  published_entity_id: string | null;
  published_at: string | null;
  last_renewed_at: string | null;
  expires_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export const IMPORT_REVIEW_STATUS_LABELS: Record<ImportReviewStatus, string> = {
  pending: "Ожидают проверки",
  in_review: "В работе",
  approved: "Одобрены",
  rejected: "Отклонены",
  duplicate: "Дубликаты",
  needs_more_info: "Требуют информации",
  ready_to_publish: "Готовы к публикации",
  quarantine: "Помойка (карантин)",
};

export const IMPORT_TARGET_COLLECTION_LABELS: Record<
  ImportReviewTargetCollection,
  string
> = {
  businesses: "Бизнесы",
  private_specialists: "Специалисты",
  services: "Услуги",
  marketplace: "Marketplace",
  jobs: "Вакансии",
  events: "События",
  organizations: "Организации",
  real_estate: "Недвижимость",
  lechu: "Лечу",
  transfers: "Переводы",
};

export const IMPORT_ENTITY_TYPE_LABELS: Record<ImportReviewEntityType, string> =
  {
    business: "Бизнес",
    private_specialist: "Специалист",
    marketplace_listing: "Marketplace",
    organization: "Организация",
    event: "Событие",
    job: "Вакансия",
    real_estate: "Недвижимость",
    lechu_listing: "Лечу",
    transfer_listing: "Переводы",
  };

export const REJECT_REASONS = [
  "spam",
  "not_commercial",
  "third_party_only",
  "insufficient_data",
  "wrong_locale",
  "prohibited",
  "other",
] as const;

export type RejectReason = (typeof REJECT_REASONS)[number];

export const REJECT_REASON_LABELS: Record<RejectReason, string> = {
  spam: "Спам",
  not_commercial: "Не коммерческое",
  third_party_only: "Только рекомендация третьего лица",
  insufficient_data: "Недостаточно данных",
  wrong_locale: "Не наш регион / язык",
  prohibited: "Запрещённый контент",
  other: "Другое",
};
