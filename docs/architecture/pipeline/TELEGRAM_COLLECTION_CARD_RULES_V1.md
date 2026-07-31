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
2. **Human moderation required** before any public `professionals` / `businesses` / listings row is created or status-raised from this pipeline.
3. **Third-party recommendations never auto-accepted** — `decision=needs_review` only (existing analyzer/schema rule).
4. **Explicit date window only** — `--date-from` / `--date-to` required; `--allow-full-history` forbidden.
5. **Allowlisted sources only** — chats in [`lib/import-review/telegram-sources.ts`](../../../lib/import-review/telegram-sources.ts); do not scrape arbitrary dialogs by default.
6. **Do not invent** names, phones, cities, addresses, categories, or prices not evidenced in the post (or clearly attributable sender profile fields already allowed today).

---

## 1. Goal of collection

Telegram collect must aim at the same field set that **full published cards** already show — not a thin contact stub. Enrichment (website/card-first) is a **second pass**; the collector should maximize structured fields from the post itself.

Target entity shapes: Professional and Business public cards (see quality rules). Marketplace/job/event/transfer/lechu follow existing classification rejects/routing; this doc prioritizes service/specialist/business ads and recommendations.

---

## 2. Required extract targets (priority order)

When implementing or changing collector/analyzer/extract, prefer filling these **in order**. Missing high-priority fields → keep `needs_review` / pending; do not invent values.

| Pri | Target (logical → DB-ish) | Why (from full cards / publish gate) | Collector duty |
|---|---|---|---|
| P0 | `display_name` / business `name` | Gate | From person/business name evidence only |
| P0 | ≥1 contact: `phone` \| `website` \| `instagram` \| `telegram_username` | Gate | Normalize per extraction contract; keep channels separate |
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

| Signal | Route intent |
|---|---|
| Named storefront + street address | `business` / direct_business_ad |
| Person offers service, no street / mobile service | `private_specialist` / direct_specialist_ad |
| Third-party «посоветуйте / рекомендую» + contact | recommendation track; **needs_review** |
| Job / marketplace / housing regex hits | reject or dedicated types per existing hard guards — not professional |
| Product-only ad with no service offer | not a professional card |

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
