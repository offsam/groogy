# Entity Index

Canonical design vs live implementation can differ.  
Design SoT: [`ARCHITECTURE_FREEZE_V1.md`](../../architecture/entity-model-v1/ARCHITECTURE_FREEZE_V1.md)  
Aliases: [`ENTITY_TYPE_MAPPING_V1.md`](../../architecture/entity-model-v1/ENTITY_TYPE_MAPPING_V1.md)  
Section routing (ingress + live move): [`ENTITY_SECTION_ROUTING_V1.md`](../../architecture/pipeline/ENTITY_SECTION_ROUTING_V1.md)  
Live map: [`PLATFORM_LIFECYCLE_V1.md`](../../architecture/runtime/PLATFORM_LIFECYCLE_V1.md)  
Data audit: [`ENTITY_AUDIT_V1.md`](../../audits/ENTITY_AUDIT_V1.md)

| Entity | Canonical doc | Main tables (as documented) | Main runtime | Source of Truth |
|---|---|---|---|---|
| **Business** | [`BUSINESS_ENTITY_V1.md`](../../architecture/entity-model-v1/BUSINESS_ENTITY_V1.md) | `businesses` | Publish / Enrichment / Admin businesses | Freeze + lifecycle § businesses |
| **Professional** | [`PROFESSIONAL_ENTITY_V1.md`](../../architecture/entity-model-v1/PROFESSIONAL_ENTITY_V1.md) | `professionals` | Publish / Enrichment / Admin recommendations | Freeze + lifecycle |
| **Marketplace** | [`MARKETPLACE_ENTITY_V1.md`](../../architecture/entity-model-v1/MARKETPLACE_ENTITY_V1.md) | `listings` + `marketplace_listing_details` | Listings publish / Import | Freeze + [`LISTINGS.md`](../runtime/LISTINGS.md) |
| **Job** | [`JOBS_ENTITY_V1.md`](../../architecture/entity-model-v1/JOBS_ENTITY_V1.md), [`JOBS_AND_PUBLISH.md`](../../architecture/entity-model-v1/JOBS_AND_PUBLISH.md) | `jobs` | Import publish / `lib/jobs/` | Freeze + lifecycle |
| **Event** | *(no dedicated ENTITY_*.md found)* — see lifecycle + freeze stubs | `events` | [`EVENTS.md`](../runtime/EVENTS.md) | [`PLATFORM_LIFECYCLE_V1.md`](../../architecture/runtime/PLATFORM_LIFECYCLE_V1.md) |
| **Vehicle** | Stub in freeze / mapping (`vehicles`) | See audit: dedicated table status disputed — **read audit before coding** | `app/vehicles/` | [`ENTITY_TYPE_MAPPING_V1.md`](../../architecture/entity-model-v1/ENTITY_TYPE_MAPPING_V1.md) + [`ENTITY_AUDIT_V1.md`](../../audits/ENTITY_AUDIT_V1.md) |
| **Real Estate** | [`REAL_ESTATE_ENTITY_V1.md`](../../architecture/entity-model-v1/REAL_ESTATE_ENTITY_V1.md) | Designed: `real_estate_listings`; live status — **read audit** | `app/real-estate/` | Freeze + [`ENTITY_AUDIT_V1.md`](../../audits/ENTITY_AUDIT_V1.md) |
| **Transfer** | Not in MVP freeze (“later” in mapping) | `listings` (`listing_type=transfer`) + `transfer_listing_details` | [`LISTINGS.md`](../runtime/LISTINGS.md) | Live code + lifecycle; design incomplete |
| **Lechu** | Not in MVP freeze (“later” in mapping) | `listings` (`listing_type=transport_carry`) + `lechu_listing_details` | [`LISTINGS.md`](../runtime/LISTINGS.md) | Live code + lifecycle; design incomplete |

---

## Shared foundation docs

- Base model: [`ENTITY_BASE_MODEL.md`](../../architecture/entity-model-v1/ENTITY_BASE_MODEL.md)
- Ownership / Source / Claim: [`OWNERSHIP_SOURCE_CLAIM.md`](../../architecture/entity-model-v1/OWNERSHIP_SOURCE_CLAIM.md)
- ACL: [`ENTITY_ACL_V1.md`](../../architecture/entity-model-v1/ENTITY_ACL_V1.md)
- Access model: [`ACCESS_MODEL_V1.md`](../../architecture/entity-model-v1/ACCESS_MODEL_V1.md)

---

## Field / quality audits (supporting, not architecture law)

- [`FIELD_AUDIT_V1.md`](../../audits/FIELD_AUDIT_V1.md)
- [`QUALITY_CARD_RULES_V1.md`](../../audits/QUALITY_CARD_RULES_V1.md)
- [`DEAD_FIELDS_V1.md`](../../audits/DEAD_FIELDS_V1.md)
- Professional cleanup Phase 1 (data only): [`PROFESSIONAL_CLEANUP_PHASE1_V1.md`](../../audits/PROFESSIONAL_CLEANUP_PHASE1_V1.md)
- Professional cleanup Phase 2 (executed): [`PROFESSIONAL_CLEANUP_PHASE2_V1.md`](../../audits/PROFESSIONAL_CLEANUP_PHASE2_V1.md)
- Professional cleanup → Admin Review handoff (closed): [`PROFESSIONAL_CLEANUP_HANDOFF_ADMIN_REVIEW_V1.md`](../../audits/PROFESSIONAL_CLEANUP_HANDOFF_ADMIN_REVIEW_V1.md)
- Pre-freeze category/entity audit: [`entity-category-unification-audit.md`](../../architecture/entity-category-unification-audit.md)
- Professional UI notes: [`PROFESSIONAL_PAGE.md`](../../architecture/entity-model-v1/PROFESSIONAL_PAGE.md)
