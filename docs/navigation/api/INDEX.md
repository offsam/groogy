# API Index

Next.js App Router handlers under `app/api/`. Navigation only.

---

## Search

| Route | File |
|---|---|
| `GET/POST` AI search intent | [`../../../app/api/search/ai/route.ts`](../../../app/api/search/ai/route.ts) |
| Businesses search | [`../../../app/api/search/businesses/route.ts`](../../../app/api/search/businesses/route.ts) |

Related: [`../runtime/SEARCH.md`](../runtime/SEARCH.md)

---

## Hub / platform stats

| Route | File |
|---|---|
| Hub resource stats | [`../../../app/api/hub-resource-stats/route.ts`](../../../app/api/hub-resource-stats/route.ts) |
| Hub category counts | [`../../../app/api/hub-category-counts/route.ts`](../../../app/api/hub-category-counts/route.ts) |
| Platform stats | [`../../../app/api/platform-stats/route.ts`](../../../app/api/platform-stats/route.ts) |
| Popular resources | [`../../../app/api/popular-resources/route.ts`](../../../app/api/popular-resources/route.ts) |

Related lib: [`../../../lib/platform/`](../../../lib/platform/)

---

## Geo

| Route | File |
|---|---|
| Resolve geo | [`../../../app/api/geo/resolve/route.ts`](../../../app/api/geo/resolve/route.ts) |

---

## Contacts / source (anti-scrape)

| Route | File |
|---|---|
| Business contacts | [`../../../app/api/business/[slug]/contacts/route.ts`](../../../app/api/business/[slug]/contacts/route.ts) |
| Business source | [`../../../app/api/business/[slug]/source/route.ts`](../../../app/api/business/[slug]/source/route.ts) |
| Professional contacts | [`../../../app/api/professional/[slug]/contacts/route.ts`](../../../app/api/professional/[slug]/contacts/route.ts) |
| Professional source | [`../../../app/api/professional/[slug]/source/route.ts`](../../../app/api/professional/[slug]/source/route.ts) |
| Listing source | [`../../../app/api/listing/[id]/source/route.ts`](../../../app/api/listing/[id]/source/route.ts) |

---

## Note

Most admin/import/publish actions are **Server Actions** under `lib/**/actions.ts`, not REST routes. See runtime entry-points.
