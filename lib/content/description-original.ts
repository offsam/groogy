/**
 * `description_original` for businesses / professionals / jobs / listings
 * ships in migration 20260730190000. Events already have the column.
 * Flip to `true` after applying that migration — until then, reads skip
 * the column so cards don't 500 the way contact_links did.
 */
export const ENTITY_DESCRIPTION_ORIGINAL_READY = false;
