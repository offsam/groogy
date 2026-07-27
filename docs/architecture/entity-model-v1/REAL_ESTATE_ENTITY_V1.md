# Real Estate Entity V1 — Freeze

Architecture + draft SQL alignment. **Not applied to production.**

Canonical with [`ARCHITECTURE_FREEZE_V1.md`](./ARCHITECTURE_FREEZE_V1.md).  
Taxonomy: [`taxonomy_real_estate_v1.json`](./taxonomy_real_estate_v1.json) · RU: `taxonomy_ru_v1_final.json`.

---

## Role

**Inventory listings** (apartment, room, house, commercial, short-term) — not agencies, not realtor profiles.

| Concern | Entity |
|---------|--------|
| Agency / brokerage | **Business** · category `real_estate_agencies` |
| Individual realtor | **Professional** · category `real_estate` |
| Unit for rent/sale | **`real_estate_listings`** · this entity |

One listing row → Real Estate hub, search, filters — no duplicate Business card for the same apartment.

---

## Base Entity

| Field | Rule |
|-------|------|
| `id`, `slug` | Required |
| `owner_profile_id` | Nullable until Claim |
| `created_by_profile_id` | Nullable for system import; set on UI create |
| `source_type`, `source_record_id`, `source_url` | Required Source; immutable |
| Import batch fields | Optional |
| `status` | Base lifecycle (`draft`/`pending`/`published`/`archived`/…) |
| `visibility` | Required for catalog |
| Timestamps | `created_at`, `updated_at`, `published_at`, `archived_at` |

---

## Domain fields

* `title`, `description`
* `offer_kind`: `sell` | `rent` (short-term may use rent + category `short_term` or attribute)
* `price_amount`, `price_currency`
* `property_type` / category via taxonomy: `apartments` · `rooms` · `houses` · `commercial` · `short_term` · `other`
* `bedrooms`, `bathrooms`, `sqft`
* Public geo + `public_address_line` / `private_address_line` / `public_exact_address`
* Optional `provider_business_id`, `provider_professional_id` (attribution, not owner)
* `attributes` jsonb for extras (pets, furnished, …) — **filters, not categories**

---

## Links

| Link | Rule |
|------|------|
| User / Profile | Owner via `owner_profile_id`; creator via `created_by_profile_id` |
| Business | Optional provider; agency stays separate Business card |
| Professional | Optional provider (listing agent) |
| Reviews | Deferred or listing-level later — not required for freeze |
| Search | `entity_type=real_estate`, category slug, geo, offer_kind, price |
| Import | `entity_type` alias `real_estate` → this table; category = taxonomy leaf |
| Claim | Sets `owner_profile_id`; does not convert listing into Business |

---

## ACL (Variant A)

No separate ACL table in v1. Manage = owner or admin (`is_admin`). Provider FKs do not grant manage.

---

## Out of scope

* Full MLS sync  
* Calendar Events hub  
* Treating every TG `real_estate_services` tag as inventory without classifier leaf fix  

---

## Freeze status

**Ready for implementation** once draft SQL Base columns are present (see `001_additive_schema.sql`).
