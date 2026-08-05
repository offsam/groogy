# TELEGRAM COLLECTION CARD RULES V1

**Status:** Source of Truth for Telegram group collect → queue/recommendations field targets.  
**Date:** 2026-07-31  
**Scope:** `scripts/telegram-collector/**`, extract into `import_comment_recommendations` / `import_review_items`.  
**Does not:** change publish gates, run collectors, or auto-publish entities.

Companion gates (what a public card needs): [`QUALITY_CARD_RULES_V1.md`](../../audits/QUALITY_CARD_RULES_V1.md).  
Companion extract formats: [`EXTRACTION_CLASSIFICATION_CONTRACT_V1.md`](./EXTRACTION_CLASSIFICATION_CONTRACT_V1.md).  
Entity copy separation: [`.cursor/rules/entity-content-structure.mdc`](../../../.cursor/rules/entity-content-structure.mdc).

---

## 0. Hard product rules

1. **No automatic publication.** Collect + analyze + extract may only write local artifacts and/or **pending** queue / recommendation rows. Never call approve/autopublish/publish RPCs or scripts as part of a Telegram collect run.
2. **Human moderation required** before any public entity row (`professionals`, `businesses`, `jobs`, `events`, marketplace/transfer/lechu listings, etc.) is created or status-raised from this pipeline.
3. **Third-party recommendations never auto-accepted** — `decision=needs_review` only (existing analyzer/schema rule).
4. **Explicit date window only** — `--date-from` / `--date-to` required; `--allow-full-history` forbidden.
5. **Allowlisted sources only** — chats in [`lib/import-review/telegram-sources.ts`](../../../lib/import-review/telegram-sources.ts); do not scrape arbitrary dialogs by default.
6. **Do not invent** names, phones, cities, addresses, categories, or prices not evidenced in the post (or clearly attributable sender profile fields already allowed today).

---

## 1. Goal of collection

Telegram collect must cover **all public catalog entity kinds** the platform has — not only specialists/businesses. Enrichment is a **second pass**; collect must classify correctly and land each post in the right pending queue with typed fields.

**In scope (must not be discarded as junk):**

| Classification / signal | Target pending track |
|---|---|
| Specialist / business ad, third-party recommendation | Professional / Business (recommendations or import-review) |
| `job_post` (вакансия / hiring / ищу работу) | **Jobs** |
| `event_ad` | **Events** |
| `marketplace_item` | **Marketplace** |
| Money transfer / перевод денег | **Transfers** |
| Flight / попутчик / лечу / carry | **Lechu** (transport_carry) |
| Housing / real estate listing | **Real estate** (or dedicated listing type — not professional) |

**Still reject only true noise:** `discussion`, `irrelevant`, empty spam.  
Pure `recommendation_request` («ищу / посоветуйте» without an offered entity) → **needs_review** into admin lane **«Я ищу»** (`[seeking]` on notes) — not a public category card, not rejected.

No autopublish — every type stays **pending / needs_review** until a human approves.

---

## 2. Required extract targets (priority order)

When implementing or changing collector/analyzer/extract, prefer filling these **in order**. Missing high-priority fields → keep `needs_review` / pending; do not invent values.

| Pri | Target (logical → DB-ish) | Why (from full cards / publish gate) | Collector duty |
|---|---|---|---|
| P0 | `display_name` / business `name` | Gate | From person/business name evidence only |
| P0 | ≥1 contact: `phone` \| `website` \| `instagram` \| `telegram_username` | Gate | Normalize per extraction contract; keep channels separate. **Exception:** lechu/transfer self-ads may use Telegram `sender_id` as contact key when the post has no phone/IG (author is reachable in-chat). |
| P0 | `preview_image_url` / `cover_image_url` | Gate / full cards almost always have `image_url` | Persist Telegram photo/media preview or sender avatar URL when available; do not skip media metadata forever |
| P0 | `city` **or** `service_area_text` (+ `state` when known) | Gate | Prefer post text; fall back to group `directory_source` region hint; never invent a street city |
| P1 | `category` (controlled vocab) — avoid dumping to `other` | Gate dislikes `pro_other` | If unsure → top candidates + `needs_review`, not silent `other` |
| P1 | Narrative: `description` **clean** + optional `headline` / `card_summary` | Full pro cards | Contacts/address stripped out of narrative (entity-content-structure) |
| P1 | `telegram_username` preserved through publish mapping | Contact path | Must map to `professionals.telegram_url` / business telegram when approving (no silent drop) |
| P1 | `booking_url` separate from `website` | CTA on full cards | Calendly / GlossGenius / Vagaro / Square Appointments / similar → `booking_url` |
| P2 | `address` + `postal_code` + `location_precision` (`street` \| `area`) | Map / business strength | Street → candidate business; area-only → professional/`service_area_text` |
| P2 | Structured `services[]` + `prices[]` | Offers on full cards | Title/price/duration when evidenced; for later `professional_services` / `business_offers` |
| P2 | `employer_name` / workplace hint | Pro-at-clinic patterns | Studio/clinic name when present |
| P3 | `payment_methods` | Completeness / UI | Venmo / Zelle / Cash App / card when evidenced |
| P3 | `email`, WhatsApp-as-channel, source post URLs | Admin + provenance | Do not count email alone as satisfying “contact gate” if SQL gate requires phone/web/IG/TG |

---

## 3. Routing (collect-time intent)

| Signal | Route intent | Decision |
|---|---|---|
| Named storefront + street address | `business` | accepted / needs_review |
| Person offers service, no street / mobile | `private_specialist` | accepted / needs_review |
| Third-party «рекомендую» + contact | recommendation → pro/business | **needs_review** only |
| Job / hiring / «вакансия» / «ищу работу» (offer) | **Jobs** | needs_review (never trash) |
| Pure «ищу / посоветуйте» (no offer) | Admin **«Я ищу»** (`[seeking]`) | needs_review — not a public card |
| Event / афиша / дата встречи | **Events** | needs_review |
| Sell/buy personal goods | **Marketplace** | needs_review |
| Перевод денег / transfer fees | **Transfers** | needs_review |
| Лечу / попутчик / carry luggage | **Lechu** | needs_review |
| Аренда/продажа жилья | Real estate listing | needs_review (not professional) |
| Pure chat, memes, off-topic | — | rejected |

**Known gap (code today):** `analyzers.py` / `schema.py` still force `job_post`, `marketplace_item`, `real_estate_listing` → `rejected`, and extract only pulls specialist/business recommendation classes. That contradicts this SoT — fix in a follow-up implementation; do not treat current reject as product law.

Final publish still requires human approve. Collect only sets classification + pending rows.

---

## 4. Output destinations (no publish)

Allowed writes from Telegram collect/extract:

- Local `scripts/telegram-collector/data/**` artifacts
- `import_comment_recommendations` with `status=pending` (prefer `--no-replace` for incremental windows)
- `import_review_items` with pending/review statuses via explicit import scripts when used

Forbidden as part of collect:

- `approveImportReviewItemAction`, autopublish scripts/RPCs, direct inserts into `professionals`/`businesses` with `approved`/`published`
- Clearing unrelated pending queues unless operator explicitly opts into replace

---

## 5. Operational constraints (unchanged, restated)

- Manual CLI only (no cron/daemon implied by this rule).
- LLM cost-capped; provider override must survive `load_env` (idempotent load).
- Secrets/session never logged or committed.
- Incremental extract must not wipe unrelated pending backlog (`--no-replace`).

---

## 6. Implementation checklist (for future code changes)

When changing collector code, verify:

- [ ] P0 fields attempted or explicitly marked missing
- [ ] Narrative redacted of contacts/address
- [ ] `booking_url` not folded into `website`
- [ ] `telegram_username` not dropped on later approve mapping
- [ ] No publish/autopublish side effects in collect/extract scripts
- [ ] Date window + allowlisted `directory_source` still enforced

---

## 7. Out of scope (next steps, not this document)

- Running a new collect window
- Changing DB publish gates
- Building autopublish from Telegram
- Full media binary download pipeline design beyond preview URL persistence
