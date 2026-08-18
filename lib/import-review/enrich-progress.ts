/** Types + labels for enrich UI stream / history (pre-publish + published). */

export const ENRICH_AUDIT_ACTION = "pre_publish_enrich";

export const ENRICH_STEP_ORDER = [
  "source_text",
  "title",
  "event_structure",
  "group_location",
  "website",
  "directories",
  "telegram_avatar",
  "ai_signals",
  "score",
  "apply",
  "cleanup",
] as const;

/** Extra steps used by published-card enrich UI (not queue pre-publish). */
export const PUBLISHED_ENRICH_STEP_ORDER = ["resources", "cleanup"] as const;

export type EnrichStepId =
  | (typeof ENRICH_STEP_ORDER)[number]
  | (typeof PUBLISHED_ENRICH_STEP_ORDER)[number];

export const ENRICH_STEP_LABELS: Record<EnrichStepId, string> = {
  source_text: "Текст источника",
  title: "Название из текста",
  event_structure: "Афиша (дата / адрес / цена)",
  group_location: "Город из текста / группы",
  website: "Сайт",
  directories: "Справочники",
  telegram_avatar: "Аватар Telegram",
  ai_signals: "AI-сигналы",
  score: "Полнота",
  apply: "Сохранение",
  cleanup: "Разбор описания (услуги / акции / чистка)",
  resources: "Обход ресурсов",
};

export type EnrichStepStatus =
  | "pending"
  | "running"
  | "done"
  | "skipped"
  | "error";

export type EnrichStepState = {
  status: EnrichStepStatus;
  detail?: string;
  found?: string[];
  directory_match?: string | null;
  score_before?: number;
  score_after?: number;
};

/** Live BFS / website resource in the admin enrich route. */
export type EnrichResourceOutcome = "ok" | "empty" | "error" | "skipped";

export type EnrichResourceStatus =
  | "queued"
  | "running"
  | "done"
  | "error"
  | "skipped";

export type EnrichResourceState = {
  url: string;
  kind: string;
  status: EnrichResourceStatus;
  /** ok = ✓, empty|error = ✗ */
  outcome?: EnrichResourceOutcome;
  fields?: string[];
  error?: string | null;
  enqueued?: string[];
};

export type EnrichStreamEvent =
  | {
      type: "started";
      id?: string;
      label: string;
      mode?: string;
    }
  | {
      type: "step";
      id?: string;
      step: EnrichStepId | string;
      status: EnrichStepStatus | string;
      detail?: string;
      found?: string[];
      directory_match?: string | null;
      score_before?: number;
      score_after?: number;
    }
  | {
      type: "resource";
      url: string;
      kind: string;
      status: EnrichResourceStatus | string;
      outcome?: EnrichResourceOutcome | string;
      fields?: string[];
      error?: string | null;
      enqueued?: string[];
    }
  | {
      type: "finished";
      result: EnrichRunResult;
    }
  | {
      type: "error";
      message: string;
    };

export type EnrichRunResult = {
  id?: string;
  label?: string;
  skipped?: boolean;
  reason?: string | null;
  entity?: string;
  p5a?: string;
  p5b?: string;
  p5c?: string;
  score_before?: number | null;
  score_after?: number | null;
  patch?: Record<string, unknown>;
  /** Visible text from website /menu (food venues) for finalize → menu_item. */
  menu_text?: string | null;
  /** Extra office streets from SPA/JSON-LD (beyond primary address_line). */
  extra_addresses?: string[];
  /**
   * Dry-run vacancy drafts (agency business → separate jobs with worksite).
   * Admin Save with key `jobs` inserts these.
   */
  pending_jobs?: Array<{
    title: string;
    description?: string;
    address_line?: string | null;
    city?: string | null;
    state_code?: string | null;
    postal_code?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    location_precision?: string | null;
  }>;
  /**
   * Dry-run preview: patch/conflicts not written yet — admin must Save selected.
   */
  pending_review?: boolean;
  /**
   * Values found on resources that differ from the card and were not applied
   * (fill-empty). Admin may confirm replace.
   */
  field_conflicts?: Array<{
    key: string;
    current: string;
    found: string;
  }>;
  /** Pre-enrich field values for patched keys (admin undo / abort). */
  before?: Record<string, unknown>;
  /** When set, this run was undone and must not be undone again. */
  reverted_at?: string | null;
  /** Keys already rolled back from this run (partial undo). */
  reverted_fields?: string[];
  steps?: {
    source_text?: string[];
    title?: string[];
    event_structure?: string[];
    group_location?: string[];
    website?: string[];
    directories?: string[];
    telegram_avatar?: string[];
    cleanup?: string[];
  };
  /** Snapshot of BFS / crawl resources for history. */
  resources?: EnrichResourceState[];
  resources_ok?: number;
  resources_failed?: number;
  services_inserted?: number;
  services_updated?: number;
  directory_match?: string | null;
  /** Router disagrees with the section the card sits in — admin decides. */
  section_mismatch?: {
    suggested: string;
    reason: string;
    confidence: string;
  };
  promoted?: boolean;
  previous_status?: string | null;
  new_status?: string | null;
};

/** Admin choice for a fill-empty conflict (leave is client-only dismiss). */
export type EnrichConflictMode = "replace" | "add";

export type EnrichConflictAction = {
  key: string;
  mode: EnrichConflictMode;
};

/** Keys that can be stored as a second value (not only replace). */
export const ENRICH_CONFLICT_ADDABLE = new Set([
  "phone",
  "email",
  "website",
  "instagram_url",
  "telegram_url",
  "address_line",
]);

export function enrichConflictCanAdd(
  key: string,
  kind?: string | null,
): boolean {
  if (!ENRICH_CONFLICT_ADDABLE.has(key)) return false;
  // Multi-office pins only on published businesses.
  if (key === "address_line") return kind === "business";
  // Queue rows: append into array fields (no contact_links / locations API).
  if (kind === "queue") {
    return key === "phone" || key === "email" || key === "website";
  }
  return kind === "business" || kind === "professional" || kind === "church";
}

export type EnrichHistoryRow = {
  id: string;
  created_at: string;
  note: string | null;
  previous_status: string | null;
  new_status: string | null;
  changed_fields: EnrichRunResult & Record<string, unknown>;
};

/** Derived from the step order so a new step can never miss its slot. */
export function emptyEnrichSteps(): Record<EnrichStepId, EnrichStepState> {
  return Object.fromEntries(
    ENRICH_STEP_ORDER.map((step) => [step, { status: "pending" }]),
  ) as Record<EnrichStepId, EnrichStepState>;
}

export const RESOURCE_KIND_LABELS: Record<string, string> = {
  source: "Источник",
  website: "Сайт",
  booking: "Запись",
  instagram: "Instagram",
  telegram: "Telegram",
  facebook: "Facebook",
  yelp: "Yelp",
  tiktok: "TikTok",
  other: "Ссылка",
};

export function resourceKindLabel(kind: string): string {
  return RESOURCE_KIND_LABELS[kind] ?? kind;
}

export function fieldLabel(key: string): string {
  const map: Record<string, string> = {
    title: "название",
    business_name: "название",
    person_name: "имя",
    phone: "телефон",
    email: "email",
    website: "сайт",
    booking_url: "запись",
    marketing_website: "сайт (маркетинг)",
    instagram: "Instagram",
    instagram_url: "Instagram",
    telegram_url: "Telegram",
    telegram_username: "Telegram",
    facebook_url: "Facebook",
    yelp_url: "Yelp",
    tiktok_url: "TikTok",
    social_links: "соцсети",
    description: "описание",
    image_url: "фото",
    gallery_urls: "галерея",
    address: "адрес",
    address_line: "адрес",
    address_multi: "несколько адресов — оставлены в тексте",
    locations: "пункты / адреса",
    geo: "карта",
    headline: "заголовок",
    hours: "часы",
    services: "услуги",
    service_offers: "цены услуг",
    menu: "меню",
    menu_text: "меню",
    promotions: "акции",
    updates: "обновления",
    events: "события",
    jobs: "вакансии",
    payment_methods: "оплата",
    payment: "оплата",
    price: "цена",
    price_label: "цена",
    city: "город / район",
    state: "штат / регион",
    state_code: "штат",
    postal_code: "индекс",
    preview_image_url: "фото",
    review_notes: "теги",
  };
  return map[key] ?? key;
}

export function applyResourceEvent(
  prev: EnrichResourceState[],
  event: Extract<EnrichStreamEvent, { type: "resource" }>,
): EnrichResourceState[] {
  const url = (event.url || "").trim();
  if (!url) return prev;
  const key = url.toLowerCase().replace(/\/$/, "");
  const idx = prev.findIndex(
    (r) => r.url.toLowerCase().replace(/\/$/, "") === key,
  );
  const next: EnrichResourceState = {
    url,
    kind: event.kind || "other",
    status: (event.status as EnrichResourceStatus) || "queued",
    outcome: event.outcome as EnrichResourceOutcome | undefined,
    fields: event.fields,
    error: event.error,
    enqueued: event.enqueued,
  };
  if (idx >= 0) {
    const copy = [...prev];
    copy[idx] = { ...copy[idx], ...next };
    return copy;
  }
  return [...prev, next];
}

export function resourcesFromResult(
  result: EnrichRunResult | null | undefined,
): EnrichResourceState[] {
  const raw = result?.resources;
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => ({
    url: String(r.url || ""),
    kind: String(r.kind || "other"),
    status:
      r.outcome === "error" || r.status === "error"
        ? "error"
        : r.outcome === "empty"
          ? "done"
          : ((r.status as EnrichResourceStatus) || "done"),
    outcome: (r.outcome as EnrichResourceOutcome) || undefined,
    fields: r.fields,
    error: r.error,
    enqueued: r.enqueued,
  }));
}

export function summarizeResources(resources: EnrichResourceState[]): {
  ok: number;
  failed: number;
} {
  let ok = 0;
  let failed = 0;
  for (const r of resources) {
    if (r.status === "queued" || r.status === "running") continue;
    if (r.outcome === "ok") ok += 1;
    else if (r.outcome === "empty" || r.outcome === "error" || r.status === "error")
      failed += 1;
  }
  return { ok, failed };
}
